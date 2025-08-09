import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../widgets/scaffold_wrapper.dart';
import '../widgets/rounded_card.dart';
import '../widgets/act_images_lazy.dart';

class ActFormPage extends StatefulWidget {
  final String? actId; // nullable: new Acts won’t have one yet
  final String? jwt;

  // ✅ NEW: prefill values coming from navigation (create flow or quick edit)
  final String? prefillName;
  final String? prefillHomeTown;

  const ActFormPage({
    super.key,
    this.actId,
    this.jwt,
    this.prefillName, // ✅
    this.prefillHomeTown, // ✅
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
    if (widget.actId != null && widget.actId!.isNotEmpty) {
      _loadAct();
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _contactEmailCtrl.dispose();
    _selectedIds.dispose();
    super.dispose();
  }

  // ------ helpers to safely read fields with varying names ------
  String _firstNonEmpty(List<dynamic> values) {
    for (final v in values) {
      final s = (v ?? '').toString().trim();
      if (s.isNotEmpty) return s;
    }
    return '';
  }

  String _joinNames(String a, String b) =>
      _firstNonEmpty(['$a $b'.trim(), a, b]);

  void _mapActData(Map<String, dynamic> data) {
    // Creator → prefer a flat display name, else build from nested fields
    final creatorDisplay =
        _firstNonEmpty([data['createdByName'], data['creatorName']]);
    final creatorFirst =
        _firstNonEmpty([data['creator']?['firstname'], data['creatorFirst']]);
    final creatorLast =
        _firstNonEmpty([data['creator']?['lastname'], data['creatorLast']]);
    _creatorName =
        _firstNonEmpty([creatorDisplay, _joinNames(creatorFirst, creatorLast)]);

    // Owner → same idea
    final ownerDisplay = _firstNonEmpty([data['ownerName']]);
    final ownerFirst =
        _firstNonEmpty([data['owner']?['firstname'], data['ownerFirst']]);
    final ownerLast =
        _firstNonEmpty([data['owner']?['lastname'], data['ownerLast']]);
    _ownerName =
        _firstNonEmpty([ownerDisplay, _joinNames(ownerFirst, ownerLast)]);

    // Home Town label only (no input)
    _homeTownLabel = _firstNonEmpty([
      data['homeTownLabel'],
      data['homeTown'], // many APIs use this
      data['home_town'],
      data['homeTownName'],
      data['homeTownText'],
      data['homeTownDisplay'],
      // last-resort: combine nested
      _joinNames(
        _firstNonEmpty([data['home']?['city'], data['city']]),
        _firstNonEmpty([data['home']?['state'], data['state']]),
      ),
    ]);

    // Editable fields
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

      final data = jsonDecode(res.body);
      if (data is Map<String, dynamic>) {
        _mapActData(data);
      } else if (data is Map) {
        _mapActData(Map<String, dynamic>.from(data));
      }
      setState(() {});
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
    if (ids.isEmpty || widget.actId == null) return;
    // TODO: call backend to remove {ids} from this act's imageIds → refresh viewer
  }

  Widget _kv(String label, String? value) {
    if (value == null || value.trim().isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 130,
            child: Text(
              label,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: Colors.black54),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final hasActId = widget.actId != null && widget.actId!.isNotEmpty;

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
                    // ✅ No Act ID shown

                    // ---- Read-only labels ----
                    _kv('Creator Name', _creatorName),
                    _kv('Owner Name', _ownerName),
                    _kv('Home Town', _homeTownLabel),

                    const SizedBox(height: 6),

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
                    if (hasActId)
                      ActImagesLazy(
                        actId: widget.actId!, // safe due to hasActId
                        jwt: widget.jwt,
                        pageSize: 12,
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
                      onPressed: hasActId ? _onAddPressed : null,
                      icon: const Icon(Icons.add),
                      label: const Text('Add'),
                    ),
                    const SizedBox(width: 8),
                    ValueListenableBuilder<Set<String>>(
                      valueListenable: _selectedIds,
                      builder: (_, set, __) => FilledButton.icon(
                        onPressed: (!hasActId || set.isEmpty)
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
