// lib/widgets/image_manager.dart
import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter/foundation.dart' show listEquals, kIsWeb;
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:file_picker/file_picker.dart';
import 'package:http_parser/http_parser.dart';

/// DTO from orchestrator /images/lookup
class _ImageDto {
  final String id;
  final String url; // SELF /images/:id/data
  final String? comment;
  final String? createdByName;
  final DateTime? createdAt;
  final String? state;

  _ImageDto({
    required this.id,
    required this.url,
    this.comment,
    this.createdByName,
    this.createdAt,
    this.state,
  });

  static _ImageDto fromJson(Map<String, dynamic> j) {
    return _ImageDto(
      id: (j['id'] ?? '').toString(),
      url: (j['url'] ?? '').toString(),
      comment: j['comment'] == null ? null : j['comment'].toString(),
      createdByName:
          j['createdByName'] == null ? null : j['createdByName'].toString(),
      createdAt: j['createdAt'] != null
          ? DateTime.tryParse(j['createdAt'].toString())
          : null,
      state: j['state']?.toString(),
    );
  }
}

class ImageStage {
  final List<String> orderedImageIds;
  final Set<String> added;
  final Set<String> removed;
  final bool dirty;
  final String? uploadBatchId;

  ImageStage({
    required this.orderedImageIds,
    required this.added,
    required this.removed,
    required this.dirty,
    required this.uploadBatchId,
  });
}

class ImageManagerController {
  // Staging
  List<String> _ordered = [];
  final Set<String> _added = {};
  final Set<String> _removed = {};

  String? _uploadBatchId; // for cancel cleanup
  bool get _hasChanges => _added.isNotEmpty || _removed.isNotEmpty;

  ImageStage get currentStage => ImageStage(
        orderedImageIds: List.unmodifiable(_ordered),
        added: Set.unmodifiable(_added),
        removed: Set.unmodifiable(_removed),
        dirty: _hasChanges,
        uploadBatchId: _uploadBatchId,
      );

  void _initialize(List<String> initial) {
    _ordered = List<String>.from(initial);
    _added.clear();
    _removed.clear();
    _uploadBatchId ??= _genBatchId();
  }

  void _insertNewAtSecond(String id) {
    final existsIdx = _ordered.indexOf(id);
    if (existsIdx >= 0) return;
    if (_ordered.isEmpty) {
      _ordered.add(id);
    } else {
      _ordered.insert(1, id);
    }
    _added.add(id);
    _removed.remove(id);
  }

  void _removeMany(Iterable<String> ids) {
    for (final id in ids) {
      _ordered.remove(id);
      if (!_added.remove(id)) {
        _removed.add(id);
      }
    }
  }

  Future<void> finalizeAfterParentSave({
    required String apiBase,
    required String? jwt,
  }) async {
    if (_added.isNotEmpty) {
      await _postJson(
        '$apiBase/images/finalize',
        {'imageIds': _added.toList()},
        jwt: jwt,
      );
    }
    if (_removed.isNotEmpty) {
      await _postJson(
        '$apiBase/images/unlink',
        {'imageIds': _removed.toList()},
        jwt: jwt,
      );
    }
    _added.clear();
    _removed.clear();
  }

  Future<void> discardOrphansIfAny({
    required String apiBase,
    required String? jwt,
  }) async {
    if (_uploadBatchId == null) return;
    try {
      await _postJson(
        '$apiBase/images/discard',
        {'uploadBatchId': _uploadBatchId},
        jwt: jwt,
      );
    } catch (_) {
      // swallow; TTL will clean eventually
    }
  }

  static Future<void> _postJson(
    String url,
    Map<String, dynamic> body, {
    String? jwt,
  }) async {
    final headers = <String, String>{
      'Content-Type': 'application/json',
      if (jwt != null && jwt.isNotEmpty) 'Authorization': 'Bearer $jwt',
      'Accept': 'application/json',
    };
    final res = await http.post(Uri.parse(url),
        headers: headers, body: jsonEncode(body));
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw Exception('POST $url failed (${res.statusCode})');
    }
  }

  static String _genBatchId() {
    final rng = Random();
    final bytes = List<int>.generate(12, (_) => rng.nextInt(256));
    return base64UrlEncode(Uint8List.fromList(bytes)).replaceAll('=', '');
  }
}

class ImageManager extends StatefulWidget {
  final String apiBase; // Orchestrator (lookup/finalize/unlink/discard)
  final String? imageServiceBase; // Image service base (uploads go here!)
  final String? jwt;
  final List<String> initialImageIds;

  final void Function(ImageStage stage)? onStageChange;
  final ImageManagerController? controller;

  const ImageManager({
    super.key,
    required this.apiBase,
    this.imageServiceBase,
    required this.jwt,
    required this.initialImageIds,
    this.onStageChange,
    this.controller,
  });

  @override
  State<ImageManager> createState() => _ImageManagerState();
}

class _ImageManagerState extends State<ImageManager> {
  late final ImageManagerController _ctrl =
      widget.controller ?? ImageManagerController();

  bool _loading = false;
  String? _error;

  final Map<String, _ImageDto> _meta = {};
  final Set<String> _selected = {};

  // Upload progress
  int _uploaded = 0;
  final ValueNotifier<int> _uploadedVN = ValueNotifier<int>(0);

  String get _uploadBase => widget.imageServiceBase?.trim().isNotEmpty == true
      ? widget.imageServiceBase!.trim()
      : widget.apiBase;

  @override
  void initState() {
    super.initState();
    _ctrl._initialize(widget.initialImageIds);
    _refreshMetadata();
  }

  @override
  void dispose() {
    _uploadedVN.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant ImageManager oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!listEquals(oldWidget.initialImageIds, widget.initialImageIds)) {
      _ctrl._initialize(widget.initialImageIds);
      _selected.clear();
      _refreshMetadata();
    }
  }

  Future<void> _refreshMetadata() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final ids = _ctrl.currentStage.orderedImageIds;
      if (ids.isEmpty) {
        _meta.clear();
      } else {
        final body = jsonEncode({'ids': ids});
        final headers = {'Content-Type': 'application/json'};
        final res = await http.post(
          Uri.parse('${widget.apiBase}/images/lookup'),
          headers: headers,
          body: body,
        );
        if (res.statusCode < 200 || res.statusCode >= 300) {
          throw Exception('lookup failed (${res.statusCode})');
        }
        final arr = jsonDecode(res.body);
        if (arr is List) {
          _meta.clear();
          for (final e in arr) {
            final dto = _ImageDto.fromJson(Map<String, dynamic>.from(e));
            _meta[dto.id] = dto;
          }
        }
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      _loading = false;
      _emitStage();
      if (mounted) setState(() {});
    }
  }

  void _emitStage() {
    final st = _ctrl.currentStage;
    widget.onStageChange?.call(st);
  }

  // ---- UI actions ----

  Future<void> _onAddPressed() async {
    if (widget.jwt == null || widget.jwt!.isEmpty) return;

    final result = await FilePicker.platform.pickFiles(
      allowMultiple: true,
      type: FileType.image,
      withData: true,
      withReadStream: true,
    );
    if (result == null || result.files.isEmpty) return;

    _diagnosePickedFiles(result.files);

    final List<_PendingFile> picks = [];
    for (final pf in result.files.take(20)) {
      final name = (pf.name.isNotEmpty ? pf.name : 'image').trim();
      final mime = _inferMimeFromName(name) ?? 'application/octet-stream';

      if (pf.bytes != null && pf.bytes!.isNotEmpty) {
        picks.add(_PendingFile.bytes(name: name, bytes: pf.bytes!, mime: mime));
      } else if (pf.readStream != null) {
        picks.add(_PendingFile.stream(
          name: name,
          stream: pf.readStream!,
          size: pf.size,
          mime: mime,
        ));
      } else if (!kIsWeb && (pf.path != null && pf.path!.isNotEmpty)) {
        picks.add(_PendingFile.path(name: name, path: pf.path!, mime: mime));
      }
    }

    debugPrint('Queuing ${picks.length} files for upload');
    if (picks.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
                'Selected files could not be read (no bytes/stream/path).'),
          ),
        );
      }
      return;
    }

    await _uploadMany(picks);
  }

  Future<void> _uploadMany(List<_PendingFile> picks) async {
    if (widget.jwt == null || widget.jwt!.isEmpty) return;
    if (picks.isEmpty) return;

    var batchId = _ctrl.currentStage.uploadBatchId;
    if (batchId == null || batchId.isEmpty) {
      batchId = _genBatchId();
      _ctrl._uploadBatchId = batchId;
    }

    // reset counters
    _uploaded = 0;
    _uploadedVN.value = 0;

    // Open the modal with the known total
    final total = picks.length;
    debugPrint('Opening progress dialog for $total items');
    _showProgress(total);

    // Concurrency cap
    const concurrency = 3;
    final queue = List<_PendingFile>.from(picks);
    final completer = Completer<void>();
    int running = 0;
    bool errorShown = false;

    Future<void> runNext() async {
      if (queue.isEmpty) {
        if (running == 0 && !completer.isCompleted) completer.complete();
        return;
      }
      final item = queue.removeAt(0);
      running++;
      try {
        final id = await _uploadOne(item, batchId!);
        if (id != null) {
          _ctrl._insertNewAtSecond(id);
          _meta[id] = _ImageDto(
            id: id,
            url: '${widget.apiBase}/images/$id/data',
            comment: null,
            createdAt: DateTime.now(),
            createdByName: null,
            state: 'orphan',
          );
          _emitStage();
        }
      } catch (e) {
        debugPrint('Upload error: $e');
        if (!errorShown) {
          errorShown = true;
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('Some uploads failed: $e')),
            );
          }
        }
      } finally {
        running--;
        _uploaded++;
        _uploadedVN.value = _uploaded;
        runNext();
      }
    }

    final starters = min(concurrency, queue.length);
    for (int i = 0; i < starters; i++) {
      runNext();
    }
    await completer.future;

    _closeProgress();

    if (mounted) setState(() {});
    await _refreshMetadata();
  }

  Future<String?> _uploadOne(_PendingFile file, String batchId) async {
    // IMPORTANT: uploads go to the image service at /images
    final uri = Uri.parse('$_uploadBase/images');
    debugPrint('Starting upload: ${file.name} → $uri');

    final req = http.MultipartRequest('POST', uri);
    if (widget.jwt != null && widget.jwt!.isNotEmpty) {
      req.headers['Authorization'] = 'Bearer ${widget.jwt}';
    }
    req.headers['Accept'] = 'application/json';
    req.fields['uploadBatchId'] = batchId;

    http.MultipartFile part;
    if (file.bytes != null) {
      part = http.MultipartFile.fromBytes(
        'file',
        file.bytes!,
        filename: file.name,
        contentType: MediaType.parse(file.mime),
      );
    } else if (file.stream != null && file.size != null) {
      part = http.MultipartFile(
        'file',
        file.stream!,
        file.size!,
        filename: file.name,
        contentType: MediaType.parse(file.mime),
      );
    } else if (!kIsWeb && file.path != null && file.path!.isNotEmpty) {
      part = await http.MultipartFile.fromPath(
        'file',
        file.path!,
        filename: file.name,
        contentType: MediaType.parse(file.mime),
      );
    } else {
      throw Exception('No data for ${file.name}');
    }
    req.files.add(part);

    // Timeout stale connections
    final streamed =
        await req.send().timeout(const Duration(seconds: 60), onTimeout: () {
      throw TimeoutException('Upload timed out for ${file.name}');
    });

    final res = await http.Response.fromStream(streamed);
    debugPrint('Upload done: ${file.name} → HTTP ${res.statusCode}');
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw Exception('upload ${file.name} failed (${res.statusCode})');
    }

    // Expecting { id, ... } from image service
    Map<String, dynamic> body;
    try {
      body = jsonDecode(res.body) as Map<String, dynamic>;
    } catch (_) {
      final trimmed = res.body.trim();
      if (trimmed.isNotEmpty) return trimmed;
      throw Exception('upload ${file.name} returned no JSON body');
    }

    final id = body['id']?.toString();
    if (id == null || id.isEmpty) {
      throw Exception('upload ${file.name} returned no id');
    }
    return id;
  }

  void _showProgress(int total) {
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => PopScope(
        canPop: false,
        child: AlertDialog(
          title: const Text('Uploading images'),
          content: AnimatedBuilder(
            animation: _uploadedVN,
            builder: (ctx, _) {
              final up = _uploadedVN.value;
              final progress = total == 0 ? 0.0 : up / total;
              return Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  LinearProgressIndicator(value: progress),
                  const SizedBox(height: 12),
                  Text('$up of $total'),
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  void _closeProgress() {
    // Try local then root navigator
    if (Navigator.of(context).canPop()) {
      Navigator.of(context).pop();
      return;
    }
    final root = Navigator.of(context, rootNavigator: true);
    if (root.canPop()) {
      root.pop();
    }
  }

  void _onRemovePressed() {
    if (_selected.isEmpty) return;
    _ctrl._removeMany(_selected);
    _selected.clear();
    _emitStage();
    setState(() {});
  }

  String _addedLine(_ImageDto dto) {
    final when = dto.createdAt;
    final who = dto.createdByName;
    final dateStr =
        when != null ? '${_mon(when.month)} ${when.day}, ${when.year}' : '—';
    if (who == null || who.isEmpty) return 'Added on $dateStr';
    return 'Added on $dateStr by $who';
  }

  String _mon(int m) {
    const arr = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec'
    ];
    return (m >= 1 && m <= 12) ? arr[m - 1] : '—';
  }

  @override
  Widget build(BuildContext context) {
    final st = _ctrl.currentStage;
    final canEdit = widget.jwt != null && widget.jwt!.isNotEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (canEdit)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                ElevatedButton.icon(
                  onPressed: _loading ? null : _onAddPressed,
                  icon: const Icon(Icons.add),
                  label: const Text('Add Image'),
                ),
                const SizedBox(width: 8),
                ElevatedButton.icon(
                  onPressed:
                      _loading || _selected.isEmpty ? null : _onRemovePressed,
                  icon: const Icon(Icons.delete_outline),
                  label: const Text('Remove Image(s)'),
                ),
                const Spacer(),
                if (_loading)
                  const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
              ],
            ),
          ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text('Error: $_error',
                style: const TextStyle(color: Colors.red)),
          ),
        LayoutBuilder(
          builder: (context, constraints) {
            final ids = st.orderedImageIds;
            if (ids.isEmpty) {
              return Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 12),
                alignment: Alignment.center,
                child: Text(
                  canEdit ? 'No images yet. Add one?' : 'No images.',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Colors.black54,
                      ),
                ),
              );
            }

            final double maxWidth = constraints.maxWidth;
            final int columns = maxWidth >= 560 ? 3 : (maxWidth >= 360 ? 2 : 1);
            final double gap = 8;
            final double tileW = (maxWidth - gap * (columns - 1)) / columns;

            return Wrap(
              spacing: gap,
              runSpacing: gap,
              children: ids.map((id) {
                final dto = _meta[id];
                final selected = _selected.contains(id);

                return SizedBox(
                  width: tileW,
                  child: Stack(
                    children: [
                      Card(
                        clipBehavior: Clip.hardEdge,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                        elevation: 1,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            AspectRatio(
                              aspectRatio: 4 / 3,
                              child: dto == null || dto.url.isEmpty
                                  ? Container(
                                      color: Colors.grey.shade200,
                                      alignment: Alignment.center,
                                      child: const Icon(Icons.image_outlined),
                                    )
                                  : Image.network(
                                      dto.url,
                                      fit: BoxFit.cover,
                                    ),
                            ),
                            Padding(
                              padding: const EdgeInsets.fromLTRB(8, 8, 8, 0),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      dto == null
                                          ? 'Added on —'
                                          : _addedLine(dto),
                                      textAlign: TextAlign.right,
                                      style: Theme.of(context)
                                          .textTheme
                                          .labelSmall
                                          ?.copyWith(color: Colors.black54),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            if (dto?.comment != null &&
                                dto!.comment!.trim().isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.fromLTRB(8, 6, 8, 10),
                                child: Text(
                                  dto.comment!,
                                  style: Theme.of(context).textTheme.bodySmall,
                                  textAlign: TextAlign.left,
                                ),
                              ),
                          ],
                        ),
                      ),
                      if (canEdit)
                        Positioned(
                          top: 8,
                          left: 8,
                          child: Material(
                            color: Colors.white.withOpacity(0.85),
                            borderRadius: BorderRadius.circular(6),
                            child: Checkbox(
                              value: selected,
                              onChanged: (v) {
                                setState(() {
                                  if (v == true) {
                                    _selected.add(id);
                                  } else {
                                    _selected.remove(id);
                                  }
                                });
                              },
                            ),
                          ),
                        ),
                    ],
                  ),
                );
              }).toList(),
            );
          },
        ),
      ],
    );
  }
}

/// Pending file that may hold bytes, a stream, or a filesystem path.
class _PendingFile {
  final String name;
  final Uint8List? bytes;
  final Stream<List<int>>? stream;
  final int? size;
  final String? path; // mobile/desktop fallback
  final String mime;

  const _PendingFile._({
    required this.name,
    required this.bytes,
    required this.stream,
    required this.size,
    required this.path,
    required this.mime,
  });

  factory _PendingFile.bytes({
    required String name,
    required Uint8List bytes,
    required String mime,
  }) =>
      _PendingFile._(
        name: name,
        bytes: bytes,
        stream: null,
        size: bytes.length,
        path: null,
        mime: mime,
      );

  factory _PendingFile.stream({
    required String name,
    required Stream<List<int>> stream,
    required int size,
    required String mime,
  }) =>
      _PendingFile._(
        name: name,
        bytes: null,
        stream: stream,
        size: size,
        path: null,
        mime: mime,
      );

  factory _PendingFile.path({
    required String name,
    required String path,
    required String mime,
  }) =>
      _PendingFile._(
        name: name,
        bytes: null,
        stream: null,
        size: null,
        path: path,
        mime: mime,
      );
}

void _diagnosePickedFiles(List<PlatformFile> files) {
  final lines = <String>[];
  lines.add('Picked ${files.length} files:');
  for (final pf in files) {
    lines.add(
      '- ${pf.name} | size=${pf.size} | bytes=${pf.bytes != null && pf.bytes!.isNotEmpty} '
      '| stream=${pf.readStream != null} | path=${pf.path?.isNotEmpty == true}',
    );
  }
  debugPrint(lines.join('\n'));
}

String _genBatchId() {
  final rng = Random();
  final bytes = List<int>.generate(12, (_) => rng.nextInt(256));
  return base64UrlEncode(Uint8List.fromList(bytes)).replaceAll('=', '');
}

String? _inferMimeFromName(String name) {
  final n = name.toLowerCase();
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.gif')) return 'image/gif';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.bmp')) return 'image/bmp';
  if (n.endsWith('.heic')) return 'image/heic';
  return null;
}
