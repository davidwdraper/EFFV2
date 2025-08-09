// lib/pages/act_form_page.dart
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../widgets/scaffold_wrapper.dart';
import '../widgets/rounded_card.dart';
import '../widgets/ownership_info.dart';
import '../widgets/submit_bar.dart';

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

  String? _createdById;
  String? _ownerId;
  String? _jwtUserId;

  final _nameCtrl = TextEditingController();
  final _contactEmailCtrl = TextEditingController();

  final _formKey = GlobalKey<FormState>();
  final _scrollController = ScrollController();

  static const double _bottomBarHeight = 64;

  bool get _hasActId => widget.actId != null && widget.actId!.isNotEmpty;

  // Enable when user owns OR created the act; allow when creating a new act (no actId yet).
  bool get _canEdit {
    if (!_hasActId) return true;
    final uid = _normId(_jwtUserId);
    if (uid.isEmpty) return false;
    return uid == _normId(_ownerId) || uid == _normId(_createdById);
  }

  @override
  void initState() {
    super.initState();
    _nameCtrl.text = widget.prefillName ?? '';
    _homeTownLabel = widget.prefillHomeTown;

    // Try to decode a real JWT to a user id; fallback to raw string.
    _jwtUserId = _extractUserId(widget.jwt) ?? widget.jwt;

    if (_hasActId) _loadAct();
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _contactEmailCtrl.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  // ---- helpers ---------------------------------------------------------------

  String _firstNonEmpty(List<dynamic> values) {
    for (final v in values) {
      final s = (v ?? '').toString().trim();
      if (s.isNotEmpty) return s;
    }
    return '';
  }

  String _joinNames(String a, String b) =>
      _firstNonEmpty(['$a $b'.trim(), a, b]);

  String _normId(String? v) => (v ?? '').toString().trim();

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

  /// Attempt to decode a JWT and pull a user id-ish field.
  /// Looks for: sub, userId, uid, id, user.id, user_id
  String? _extractUserId(String? token) {
    if (token == null || token.isEmpty) return null;
    if (!token.contains('.')) return null; // not a JWT
    try {
      final parts = token.split('.');
      if (parts.length < 2) return null;
      String b64 = parts[1].replaceAll('-', '+').replaceAll('_', '/');
      // pad
      while (b64.length % 4 != 0) {
        b64 += '=';
      }
      final jsonStr = utf8.decode(base64.decode(b64));
      final obj = json.decode(jsonStr);
      if (obj is! Map) return null;

      String pick(dynamic x) {
        if (x == null) return '';
        if (x is String) return x.trim();
        if (x is num) return x.toString();
        return '';
      }

      final candidates = <String>[
        pick(obj['sub']),
        pick(obj['userId']),
        pick(obj['uid']),
        pick(obj['id']),
        obj['user'] is Map ? pick((obj['user'] as Map)['id']) : '',
        pick(obj['user_id']),
      ].where((e) => e.isNotEmpty).toList();

      return candidates.isNotEmpty ? candidates.first : null;
    } catch (_) {
      return null;
    }
  }

  /// Unwrap common envelopes from orchestrator/service responses.
  Map<String, dynamic> _unwrapActEnvelope(Map<String, dynamic> map) {
    Map<String, dynamic> cur = map;
    for (int i = 0; i < 3; i++) {
      if (cur.length == 1) {
        final k = cur.keys.first;
        final v = cur[k];
        if (v is Map) {
          if (['act', 'data', 'result', 'item'].contains(k)) {
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
    // Creator
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
      data['createdById'],
      data['createdBy'],
      data['creatorId'],
      data['creatorID'],
    ]);

    // Owner
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
      data['ownerId'],
      data['ownedBy'],
      data['userOwnerId'],
      data['ownerID'],
    ]);

    // Home town
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

    // Editable fields
    final actName = _firstNonEmpty([data['name']]);
    if (actName.isNotEmpty) _nameCtrl.text = actName;
    final email = _firstNonEmpty(
        [data['contactEmail'], data['eMailAddr'], data['email']]);
    _contactEmailCtrl.text = email;

    // Ensure _jwtUserId is decoded if possible (in case widget.jwt was null at init).
    _jwtUserId ??= _extractUserId(widget.jwt) ?? widget.jwt;
  }

  // ---- data -----------------------------------------------------------------

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
      setState(() {});
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  // ---- actions --------------------------------------------------------------

  void _onCancelPressed() {
    Navigator.of(context).maybePop();
  }

  Future<void> _onSavePressed() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    final payload = {
      'name': _nameCtrl.text.trim(),
      'eMailAddr': _contactEmailCtrl.text.trim().isNotEmpty
          ? _contactEmailCtrl.text.trim()
          : null,
    };
    try {
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
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  void _onClaimPressed() {
    debugPrint('Claim pressed for actId=${widget.actId} by userId=$_jwtUserId');
  }

  // ---- UI -------------------------------------------------------------------

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
                        padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
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
                            ],
                          ),
                        ),
                      ),
                    ),

                    // --- Pinned bottom action area: translucent bg under, crisp buttons on top ---
                    SizedBox(
                      height: _bottomBarHeight,
                      child: Stack(
                        children: [
                          // Translucent background layer INSIDE the card, preserving rounded bottom
                          Positioned.fill(
                            child: Container(
                              decoration: BoxDecoration(
                                color: Colors.black.withOpacity(
                                    0.08), // <<< adjust transparency here
                                borderRadius: const BorderRadius.vertical(
                                  bottom: Radius.circular(12),
                                ),
                              ),
                            ),
                          ),
                          // Buttons row on TOP of the translucent layer (crisp edges)
                          Positioned.fill(
                            child: Padding(
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 12),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.end,
                                children: [
                                  // Place "Update Act" to the right of Cancel by flipping internal LTR to RTL.
                                  Directionality(
                                    textDirection: TextDirection.rtl,
                                    child: SizedBox(
                                      height: double.infinity,
                                      child: SubmitBar(
                                        primaryLabel: 'Update Act',
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
                    // --- end pinned area ---
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
