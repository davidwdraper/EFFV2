import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../widgets/scaffold_wrapper.dart';
import '../widgets/rounded_card.dart';
import '../widgets/act_images_lazy.dart';
import '../widgets/ownership_info.dart'; // ✅ reuse the shared widget

class ActFormPage extends StatefulWidget {
  final String? actId; // nullable: new Acts won’t have one yet
  final String? jwt;

  // ✅ Prefill values (create flow or quick edit)
  final String? prefillName;
  final String? prefillHomeTown;

  const ActFormPage({
    super.key,
    this.actId,
    this.jwt,
    this.prefillName,
    this.prefillHomeTown,
  });

  @override
  State<ActFormPage> createState() => _ActFormPageState();
}

class _ActFormPageState extends State<ActFormPage> {
  // ---- tweak this if you want to centralize config ----
  static const String _apiBase = 'http://localhost:4000';

  bool _loading = false;
  String? _error;

  // Read-only labels
  String? _creatorName;
  String? _ownerName;
  String? _homeTownLabel;

  // Editable fields
  final _nameCtrl = TextEditingController();
  final _contactEmailCtrl = TextEditingController();

  // Image selection for delete
  final ValueNotifier<Set<String>> _selectedIds =
      ValueNotifier<Set<String>>(<String>{});
  static const double _bottomBarHeight = 64;

  @override
  void initState() {
    super.initState();

    // ✅ Show prefill immediately (so create flow or slow networks still render)
    _nameCtrl.text = widget.prefillName ?? '';
    _homeTownLabel = widget.prefillHomeTown;

    // Edit flow: fetch from server and overwrite with source of truth
    if (_hasActId) {
      _loadAct();
    }
  }

  bool get _hasActId => widget.actId != null && widget.actId!.isNotEmpty;

  @override
  void dispose() {
    _nameCtrl.dispose();
    _contactEmailCtrl.dispose();
    _selectedIds.dispose();
    super.dispose();
  }

  // ------ tiny utils ------
  String _firstNonEmpty(List<dynamic> values) {
    for (final v in values) {
      final s = (v ?? '').toString().trim();
      if (s.isNotEmpty) return s;
    }
    return '';
  }

  String _joinNames(String a, String b) =>
      _firstNonEmpty(['$a $b'.trim(), a, b]);

  String? _getName(dynamic v) {
    if (v == null) return null;
    if (v is String && v.trim().isNotEmpty) return v.trim();
    if (v is Map) {
      final first =
          _firstNonEmpty([v['firstname'], v['firstName'], v['first']]);
      final last = _firstNonEmpty([v['lastname'], v['lastName'], v['last']]);
      final full = _firstNonEmpty([v['name'], _joinNames(first, last)]);
      return full.isEmpty ? null : full;
    }
    return null;
  }

  String? _getTownLabel(dynamic v) {
    if (v == null) return null;
    if (v is String && v.trim().isNotEmpty) return v.trim();
    if (v is Map) {
      final fromMap = _firstNonEmpty([
        v['label'],
        v['name'],
        v['display'],
        _joinNames(_firstNonEmpty([v['city']]), _firstNonEmpty([v['state']])),
      ]);
      return fromMap.isEmpty ? null : fromMap;
    }
    return null;
  }

  /// Unwrap common envelopes from orchestrator/service responses.
  Map<String, dynamic> _unwrapActEnvelope(Map<String, dynamic> map) {
    Map<String, dynamic> cur = map;
    for (int i = 0; i < 3; i++) {
      if (cur.length == 1) {
        final k = cur.keys.first;
        final v = cur[k];
        if (v is Map) {
          if (k == 'act' || k == 'data' || k == 'result' || k == 'item') {
            cur = Map<String, dynamic>.from(v);
            continue;
          }
        }
      }
      break;
    }
    if (cur.containsKey('act') && cur['act'] is Map) {
      return Map<String, dynamic>.from(cur['act'] as Map);
    }
    return cur;
  }

  void _normalizeAndMapAct(Map<String, dynamic> data) {
    // ---- Creator ----
    final creator =
        _firstNonEmpty([data['createdByName'], data['creatorName']]);
    _creatorName = _firstNonEmpty([
      creator,
      _getName(data['createdBy']),
      _getName(data['creator']),
      _joinNames(
        _firstNonEmpty([data['creatorFirst']]),
        _firstNonEmpty([data['creatorLast']]),
      ),
    ]);

    // ---- Owner ----
    final ownerDisp = _firstNonEmpty([data['ownerName']]);
    _ownerName = _firstNonEmpty([
      ownerDisp,
      _getName(data['owner']),
      _getName(data['userOwner']),
      _getName(data['userOwnerIdObj']),
      _joinNames(
        _firstNonEmpty([data['ownerFirst']]),
        _firstNonEmpty([data['ownerLast']]),
      ),
    ]);

    // ---- Home Town (label-only) ----
    _homeTownLabel = _firstNonEmpty([
      data['homeTownLabel'],
      data['homeTownName'],
      data['homeTownText'],
      data['homeTownDisplay'],
      data['homeTown'],
      data['home_town'],
      _getTownLabel(data['homeTownObj']),
      _getTownLabel(data['home']),
      _getTownLabel(data['town']),
      _getTownLabel({'city': data['city'], 'state': data['state']}),
      widget.prefillHomeTown, // fallback to prefill
    ]);

    // ---- Editable fields ----
    final actName = _firstNonEmpty([data['name']]);
    if (actName.isNotEmpty) _nameCtrl.text = actName;

    final email = _firstNonEmpty(
        [data['contactEmail'], data['eMailAddr'], data['email']]);
    _contactEmailCtrl.text = email;
  }

  Future<void> _loadAct() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final uri = Uri.parse('$_apiBase/acts/${widget.actId}');
      final headers = <String, String>{
        'Content-Type': 'application/json',
        if (widget.jwt != null && widget.jwt!.isNotEmpty)
          'Authorization': 'Bearer ${widget.jwt}',
      };
      final res = await http.get(uri, headers: headers);

      if (res.statusCode != 200) {
        throw Exception('Failed to load act (${res.statusCode})');
      }

      final decoded = jsonDecode(res.body);
      if (decoded is! Map) {
        throw Exception('Unexpected response shape (not a Map)');
      }

      Map<String, dynamic> root =
          Map<String, dynamic>.from(decoded as Map<dynamic, dynamic>);

      try {
        debugPrint('Act payload keys: ${root.keys.toList()}');
      } catch (_) {}

      final actMap = _unwrapActEnvelope(root);

      try {
        debugPrint('Act (unwrapped) keys: ${actMap.keys.toList()}');
      } catch (_) {}

      _normalizeAndMapAct(actMap);

      if (mounted) setState(() {});
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _onAddPressed() async {
    // TODO: open picker → upload → append to act.imageIds → refresh viewer
  }

  Future<void> _onDeletePressed() async {
    final ids = _selectedIds.value.toList();
    if (ids.isEmpty || !_hasActId) return;
    // TODO: call backend to remove {ids} from this act's imageIds → refresh viewer
  }

  @override
  Widget build(BuildContext context) {
    return ScaffoldWrapper(
      title: null,
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
      child: Stack(
        children: [
          // ---------------- Main scrollable content ----------------
          ListView(
            padding: EdgeInsets.zero,
            children: [
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text('Error: $_error',
                      style: const TextStyle(color: Colors.red)),
                ),

              RoundedCard(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // =================== Top Row ===================
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        // Left: static "Home Town" label + value
                        Expanded(
                          child: Row(
                            children: [
                              Text(
                                'Home Town',
                                style: Theme.of(context)
                                    .textTheme
                                    .bodyMedium
                                    ?.copyWith(color: Colors.black54),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  _homeTownLabel?.trim().isNotEmpty == true
                                      ? _homeTownLabel!
                                      : '—',
                                  overflow: TextOverflow.ellipsis,
                                  style: Theme.of(context).textTheme.bodyMedium,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 12),

                        // Right: Creator / Owner via shared OwnershipInfo widget (right-aligned via wrapper)
                        Align(
                          alignment: Alignment.centerRight,
                          child: OwnershipInfo(
                            creatorName: _creatorName,
                            ownerName: _ownerName,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    // ========================================================

                    // ---- Editable fields (prefilled; server may overwrite) ----
                    TextField(
                      controller: _nameCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Act Name',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),

                    TextField(
                      controller: _contactEmailCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Contact Email',
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.emailAddress,
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 12),

              // ---- Image Viewer section right under Contact Email ----
              RoundedCard(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text('Images',
                            style: Theme.of(context).textTheme.titleMedium),
                        if (_loading) ...[
                          const SizedBox(width: 8),
                          const SizedBox(
                              height: 16,
                              width: 16,
                              child: CircularProgressIndicator(strokeWidth: 2)),
                        ],
                      ],
                    ),
                    const SizedBox(height: 12),
                    if (_hasActId)
                      ActImagesLazy(
                        actId: widget.actId!, // safe due to _hasActId
                        jwt: widget.jwt,
                        pageSize: 12,
                        showControls: true, // edit context → allow selection
                        onSelectionChanged: (ids) =>
                            _selectedIds.value = Set<String>.from(ids),
                      )
                    else
                      Text(
                        'Save this Act to start adding images.',
                        style: Theme.of(context)
                            .textTheme
                            .bodyMedium
                            ?.copyWith(color: Colors.black54),
                      ),
                  ],
                ),
              ),

              // spacer so content isn't hidden by bottom bar
              SizedBox(
                height: _bottomBarHeight +
                    MediaQuery.of(context).padding.bottom +
                    16,
              ),
            ],
          ),

          // ---------------- Pinned semi-transparent bottom bar ----------------
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: SafeArea(
              top: false,
              child: Container(
                height: _bottomBarHeight,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: Colors.black.withOpacity(0.35),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.2),
                      blurRadius: 8,
                      offset: const Offset(0, -2),
                    ),
                  ],
                ),
                child: Row(
                  children: [
                    FilledButton.icon(
                      onPressed: _hasActId ? _onAddPressed : null,
                      icon: const Icon(Icons.add),
                      label: const Text('Add'),
                    ),
                    const SizedBox(width: 8),
                    ValueListenableBuilder<Set<String>>(
                      valueListenable: _selectedIds,
                      builder: (_, set, __) => FilledButton.icon(
                        onPressed: (!_hasActId || set.isEmpty)
                            ? null
                            : _onDeletePressed,
                        icon: const Icon(Icons.delete_outline),
                        label: Text(
                          set.isEmpty ? 'Delete' : 'Delete (${set.length})',
                        ),
                      ),
                    ),
                    const Spacer(),
                    const Icon(Icons.swipe_up, size: 18, color: Colors.white70),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
