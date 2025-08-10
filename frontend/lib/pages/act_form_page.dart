// lib/pages/act_form_page.dart
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../widgets/scaffold_wrapper.dart';
import '../widgets/rounded_card.dart';
import '../widgets/ownership_info.dart';
import '../widgets/submit_bar.dart';
import '../widgets/image_manager.dart'; // ✅ NEW

class ActFormPage extends StatefulWidget {
  final String? actId;
  final String? jwt;
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
  static const String _apiBase = 'http://localhost:4000';

  bool _loading = false;
  String? _error;

  String? _creatorName;
  String? _ownerName;
  String? _homeTownLabel;
  String? _townId;

  String? _createdById;
  String? _ownerId;
  String? _jwtUserId;
  String? _jwtUserName;

  final _nameCtrl = TextEditingController();
  final _contactEmailCtrl = TextEditingController();

  final _formKey = GlobalKey<FormState>();
  final _scrollController = ScrollController();

  static const double _bottomBarHeight = 64;

  bool get _hasActId => widget.actId != null && widget.actId!.isNotEmpty;

  bool get _canEdit {
    if (!_hasActId) return true;
    final uid = _canon(_jwtUserId);
    if (uid.isEmpty) return false;
    final owner = _canon(_ownerId);
    final creator = _canon(_createdById);
    return uid == owner || uid == creator;
  }

  bool _argsLoaded = false;

  // ✅ Image state + controller
  final ImageManagerController _imgController = ImageManagerController();
  List<String> _imageIds = []; // authoritative list from backend for this Act
  bool _imagesDirty = false; // true if staged changes exist

  @override
  void initState() {
    super.initState();
    _nameCtrl.text = widget.prefillName ?? '';
    _homeTownLabel = widget.prefillHomeTown;

    _jwtUserId = _extractUserId(widget.jwt) ?? widget.jwt;
    _jwtUserName = _extractUserName(widget.jwt);

    if (!_hasActId) {
      _createdById = _jwtUserId;
      _ownerId = _jwtUserId;
      _creatorName = _jwtUserName;
      _ownerName = _jwtUserName;
    }

    if (_hasActId) _loadAct();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_argsLoaded) return;
    final args = ModalRoute.of(context)?.settings.arguments;
    if (args is Map) {
      final rawTownId = args['townId']?.toString();
      final rawHomeTown = args['prefillHomeTown']?.toString();
      if (rawTownId != null && rawTownId.isNotEmpty) _townId = rawTownId;
      if ((rawHomeTown != null && rawHomeTown.isNotEmpty)) {
        _homeTownLabel ??= rawHomeTown;
      }
    }
    _argsLoaded = true;
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _contactEmailCtrl.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  String _firstNonEmpty(List<dynamic> values) {
    for (final v in values) {
      final s = (v ?? '').toString().trim();
      if (s.isNotEmpty) return s;
    }
    return '';
  }

  String _joinNames(String a, String b) =>
      _firstNonEmpty(['$a $b'.trim(), a, b]);

  String _canon(String? v) =>
      (v ?? '').trim().toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');

  bool _looksLikeJwt(String? v) {
    if (v == null) return false;
    final parts = v.split('.');
    return parts.length >= 3 && parts[0].isNotEmpty && parts[1].isNotEmpty;
  }

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

  String? _getId(dynamic v) {
    if (v == null) return null;
    if (v is num) return v.toString();
    if (v is String) return v.trim().isNotEmpty ? v.trim() : null;
    if (v is Map) {
      final m = v;
      final candidates = [
        m['_id'],
        m['id'],
        m['uid'],
        m['userId'],
        m['user_id'],
        m['value'],
      ];
      for (final c in candidates) {
        final pick = _getId(c);
        if (pick != null && pick.isNotEmpty) return pick;
      }
    }
    return null;
  }

  Map<String, dynamic>? _decodeJwtPayload(String? token) {
    if (token == null || token.isEmpty) return null;
    final raw = token.startsWith('Bearer ') ? token.substring(7) : token;
    if (!_looksLikeJwt(raw)) return null;
    final parts = raw.split('.');
    if (parts.length < 2) return null;
    String payload = parts[1];
    try {
      String s = payload.replaceAll('-', '+').replaceAll('_', '/');
      while (s.length % 4 != 0) {
        s += '=';
      }
      final jsonStr = utf8.decode(base64.decode(s));
      final obj = json.decode(jsonStr);
      return (obj is Map<String, dynamic>) ? obj : null;
    } catch (_) {
      return null;
    }
  }

  String? _extractUserId(String? token) {
    final obj = _decodeJwtPayload(token);
    if (obj == null) return null;
    String pick(dynamic x) {
      if (x == null) return '';
      if (x is String) return x.trim();
      if (x is num) return x.toString();
      return '';
    }

    final userMap = (obj['user'] is Map) ? (obj['user'] as Map) : null;
    final candidates = <String>[
      pick(obj['_id']),
      pick(obj['sub']),
      pick(obj['userId']),
      pick(obj['uid']),
      pick(obj['id']),
      if (userMap != null) pick(userMap['_id']),
      if (userMap != null) pick(userMap['id']),
      pick(obj['user_id']),
    ].where((e) => e.isNotEmpty).toList();
    return candidates.isNotEmpty ? candidates.first : null;
  }

  String? _extractUserName(String? token) {
    final obj = _decodeJwtPayload(token);
    if (obj == null) return null;
    final name = _firstNonEmpty([
      obj['name'],
      _joinNames(
        _firstNonEmpty([obj['firstname'], obj['firstName'], obj['first']]),
        _firstNonEmpty([obj['lastname'], obj['lastName'], obj['last']]),
      ),
    ]);
    if (name.isNotEmpty) return name;
    final userMap = (obj['user'] is Map) ? (obj['user'] as Map) : null;
    if (userMap != null) {
      final n = _firstNonEmpty([
        userMap['name'],
        _joinNames(
          _firstNonEmpty(
              [userMap['firstname'], userMap['firstName'], userMap['first']]),
          _firstNonEmpty(
              [userMap['lastname'], userMap['lastName'], userMap['last']]),
        ),
      ]);
      return n.isNotEmpty ? n : null;
    }
    return null;
  }

  String _getTownLabel(dynamic town) {
    if (town == null) return '';
    if (town is String) return town.trim();
    if (town is Map) {
      final city = (town['city'] ?? '').toString().trim();
      final state = (town['state'] ?? '').toString().trim();
      if (city.isNotEmpty && state.isNotEmpty) return '$city, $state';
      return city.isNotEmpty ? city : state;
    }
    return '';
  }

  Map<String, dynamic> _unwrapActEnvelope(Map<String, dynamic> map) {
    Map<String, dynamic> cur = map;
    for (int i = 0; i < 3; i++) {
      if (cur.length == 1) {
        final k = cur.keys.first;
        final v = cur[k];
        if (v is Map && ['act', 'data', 'result', 'item'].contains(k)) {
          cur = Map<String, dynamic>.from(v);
          continue;
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
    _createdById = _firstNonEmpty([
      _getId(data['createdBy']),
      _getId(data['creator']),
      _getId(data['createdById']),
      _getId(data['creatorId']),
      _getId(data['creatorID']),
      data['createdById'],
      data['createdBy'],
      data['creatorId'],
      data['creatorID'],
    ]);

    final ownerDisp = _firstNonEmpty([data['ownerName'], data['ownedByName']]);
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
    _ownerId = _firstNonEmpty([
      _getId(data['owner']),
      _getId(data['userOwner']),
      _getId(data['userOwnerIdObj']),
      _getId(data['ownerId']),
      _getId(data['ownedBy']),
      _getId(data['userOwnerId']),
      _getId(data['ownerID']),
      data['ownerId'],
      data['ownedBy'],
      data['userOwnerId'],
      data['ownerID'],
    ]);

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
      widget.prefillHomeTown,
    ]);

    _townId = _firstNonEmpty([
      _getId(data['townId']),
      _getId(data['homeTownId']),
      _getId(data['homeTownObj']),
      _getId(data['town']),
    ]);

    final actName = _firstNonEmpty([data['name']]);
    if (actName.isNotEmpty) _nameCtrl.text = actName;
    final email = _firstNonEmpty(
        [data['contactEmail'], data['eMailAddr'], data['email']]);
    _contactEmailCtrl.text = email;

    // ✅ imageIds (from backend)
    final img = data['imageIds'];
    if (img is List) {
      _imageIds = img.whereType<String>().toList();
    } else {
      _imageIds = [];
    }

    _jwtUserId ??= _extractUserId(widget.jwt) ?? widget.jwt;

    if (_looksLikeJwt(_jwtUserId) &&
        (_ownerId != null && _ownerId!.isNotEmpty) &&
        (widget.jwt?.contains(_ownerId!) ?? false)) {
      _jwtUserId = _ownerId;
    }
  }

  Future<void> _loadAct() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final uri = Uri.parse('$_apiBase/acts/${widget.actId}');
      final headers = {
        'Content-Type': 'application/json',
        if (widget.jwt?.isNotEmpty ?? false)
          'Authorization': 'Bearer ${widget.jwt}',
      };
      final res = await http.get(uri, headers: headers);
      if (res.statusCode != 200) {
        throw Exception('Failed to load act (${res.statusCode})');
      }
      final decoded = jsonDecode(res.body);
      if (decoded is! Map) throw Exception('Unexpected response shape');
      final actMap = _unwrapActEnvelope(
          Map<String, dynamic>.from(decoded as Map<dynamic, dynamic>));
      _normalizeAndMapAct(actMap);

      if (mounted) setState(() {});
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _onCancelPressed() async {
    // If there were staged uploads, ask image manager to discard its orphans.
    await _imgController.discardOrphansIfAny(
      apiBase: _apiBase,
      jwt: widget.jwt,
    );
    if (!mounted) return;
    Navigator.of(context).maybePop();
  }

  Future<void> _onSavePressed() async {
    if (!_formKey.currentState!.validate()) return;

    if (!_hasActId) {
      final townMissing = (_townId == null || _townId!.trim().isEmpty) &&
          !((_homeTownLabel ?? '').trim().isNotEmpty);
      if (townMissing) {
        setState(() => _error = 'Select a hometown before creating the act.');
        return;
      }
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      // ✅ Ask image manager for current staged order and deltas
      final stage = _imgController.currentStage;
      final orderedIds = stage?.orderedImageIds ?? _imageIds;

      final payload = {
        'name': _nameCtrl.text.trim(),
        'eMailAddr': _contactEmailCtrl.text.trim().isNotEmpty
            ? _contactEmailCtrl.text.trim()
            : null,
        if (_townId != null && _townId!.trim().isNotEmpty) 'townId': _townId,
        if ((_homeTownLabel ?? '').trim().isNotEmpty)
          'homeTown': _homeTownLabel,
        if (!_hasActId && (_jwtUserId?.isNotEmpty ?? false))
          'userCreateId': _jwtUserId,
        if (!_hasActId && (_jwtUserId?.isNotEmpty ?? false))
          'userOwnerId': _jwtUserId,
        if (!_hasActId && (_jwtUserName?.isNotEmpty ?? false))
          'createdByName': _jwtUserName,
        if (!_hasActId && (_jwtUserName?.isNotEmpty ?? false))
          'ownerName': _jwtUserName,

        // ✅ include images (canonical order) on save
        'imageIds': orderedIds,
      };

      final headers = {
        'Content-Type': 'application/json',
        if (widget.jwt?.isNotEmpty ?? false)
          'Authorization': 'Bearer ${widget.jwt}',
      };

      late final http.Response res;
      if (_hasActId) {
        res = await http.put(
          Uri.parse('$_apiBase/acts/${widget.actId}'),
          headers: headers,
          body: jsonEncode(payload),
        );
      } else {
        res = await http.post(
          Uri.parse('$_apiBase/acts'),
          headers: headers,
          body: jsonEncode(payload),
        );
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw Exception('Save failed (${res.statusCode})');
      }

      // ✅ Finalize staged image changes AFTER the act is saved
      await _imgController.finalizeAfterParentSave(
        apiBase: _apiBase,
        jwt: widget.jwt,
      );

      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _onClaimPressed() {}

  @override
  Widget build(BuildContext context) {
    return ScaffoldWrapper(
      title: null,
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final maxW = constraints.maxWidth;
          final screenH = MediaQuery.of(context).size.height;
          return Center(
            child: SizedBox(
              width: maxW < 600 ? maxW : 600,
              height: screenH,
              child: RoundedCard(
                padding: EdgeInsets.zero,
                child: Column(
                  children: [
                    Expanded(
                      child: SingleChildScrollView(
                        controller: _scrollController,
                        padding: const EdgeInsets.fromLTRB(
                            12, 12, 12, 12 + _bottomBarHeight),
                        child: Form(
                          key: _formKey,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (_error != null)
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 12),
                                  child: Text(
                                    'Error: $_error',
                                    style: const TextStyle(color: Colors.red),
                                  ),
                                ),
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.center,
                                children: [
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
                                            _homeTownLabel?.trim().isNotEmpty ==
                                                    true
                                                ? _homeTownLabel!
                                                : '—',
                                            overflow: TextOverflow.ellipsis,
                                            style: Theme.of(context)
                                                .textTheme
                                                .bodyMedium,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  OwnershipInfo(
                                    creatorName: _creatorName,
                                    ownerName: _ownerName,
                                    createdById: _createdById,
                                    ownerId: _ownerId,
                                    jwtUserId: _jwtUserId,
                                    onClaim: _onClaimPressed,
                                  ),
                                ],
                              ),
                              const SizedBox(height: 12),
                              TextFormField(
                                controller: _nameCtrl,
                                decoration: const InputDecoration(
                                  labelText: 'Act Name',
                                  border: OutlineInputBorder(),
                                ),
                                validator: (v) =>
                                    (v == null || v.trim().isEmpty)
                                        ? 'Act name is required'
                                        : null,
                              ),
                              const SizedBox(height: 12),
                              TextFormField(
                                controller: _contactEmailCtrl,
                                decoration: const InputDecoration(
                                  labelText: 'Contact Email',
                                  border: OutlineInputBorder(),
                                ),
                                keyboardType: TextInputType.emailAddress,
                              ),

                              // 🔽🔽🔽 IMAGE MANAGER mounts here
                              const SizedBox(height: 16),
                              ImageManager(
                                key: const ValueKey('act_image_manager'),
                                apiBase: _apiBase,
                                jwt: widget.jwt,
                                initialImageIds: _imageIds,
                                onStageChange: (stage) {
                                  _imagesDirty = stage.dirty;
                                  // No setState needed unless you want to reflect elsewhere
                                },
                                controller: _imgController,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    SizedBox(
                      height: _bottomBarHeight,
                      child: Stack(
                        children: [
                          Positioned.fill(
                            child: Container(
                              decoration: BoxDecoration(
                                color: Colors.black.withOpacity(0.08),
                                borderRadius: const BorderRadius.vertical(
                                  bottom: Radius.circular(12),
                                ),
                              ),
                            ),
                          ),
                          Positioned.fill(
                            child: Padding(
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 12),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.end,
                                children: [
                                  Directionality(
                                    textDirection: TextDirection.rtl,
                                    child: SizedBox(
                                      height: double.infinity,
                                      child: SubmitBar(
                                        primaryLabel: _hasActId
                                            ? 'Update Act'
                                            : 'Create Act',
                                        onPrimary: _loading || !_canEdit
                                            ? null
                                            : _onSavePressed,
                                        onCancel:
                                            _loading ? null : _onCancelPressed,
                                        loading: _loading,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
