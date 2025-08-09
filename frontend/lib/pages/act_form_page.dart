// lib/pages/act_form_page.dart
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:http/http.dart' as http;

import '../providers/auth_provider.dart';
import '../widgets/logo_menu_bar.dart';
import '../widgets/page_wrapper.dart';
import '../widgets/rounded_card.dart';
import '../widgets/page_buttons_row.dart';
import '../widgets/ownership_info.dart'; // ✅ NEW

class ActFormArgs {
  final String? actId; // signals edit mode
  final String? prefillName;
  final String? prefillHomeTown;
  const ActFormArgs({this.actId, this.prefillName, this.prefillHomeTown});
}

class ActFormPage extends StatefulWidget {
  const ActFormPage({super.key, this.args});
  final ActFormArgs? args;

  @override
  State<ActFormPage> createState() => _ActFormPageState();
}

class _ActFormPageState extends State<ActFormPage> {
  final _formKey = GlobalKey<FormState>();

  final _nameCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _homeTownCtrl = TextEditingController();

  // Hometown as read-only when provided/loaded
  String? _prefilledHomeTown;

  TownSuggestion? _selectedTown;
  bool _submitting = false;

  // Edit mode
  bool _isUpdate = false;
  String? _actId;

  // Ownership display
  String? _creatorName;
  String? _ownerName;
  String? _ownerId;

  // Match main.dart
  String get _apiBase => const String.fromEnvironment(
        'EFF_API_BASE',
        defaultValue: 'http://localhost:4000',
      );
  static const String _townsSuggestPath = '/towns/search';

  @override
  void initState() {
    super.initState();
    final a = widget.args;

    // Prefill name immediately
    final prefillName = (a?.prefillName ?? '').trim();
    if (prefillName.isNotEmpty) _nameCtrl.text = prefillName;

    // Prefilled hometown (from search) shows as label
    final prefillTown = (a?.prefillHomeTown ?? '').trim();
    if (prefillTown.isNotEmpty) _prefilledHomeTown = prefillTown;

    // Default ownership for create
    final auth = context.read<AuthProvider>();
    _creatorName = auth.userDisplayName;
    _ownerName = auth.userDisplayName;
    _ownerId = auth.userId;

    // Edit mode if actId present — load existing record
    if ((a?.actId ?? '').isNotEmpty) {
      _isUpdate = true;
      _actId = a!.actId;
      _loadAct();
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _emailCtrl.dispose();
    _homeTownCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadAct() async {
    if (_actId == null) return;
    try {
      final auth = context.read<AuthProvider>();
      final uri = Uri.parse('$_apiBase/acts/$_actId');
      final resp = await http.get(
        uri,
        headers: {
          'Content-Type': 'application/json',
          if (auth.token != null) 'Authorization': 'Bearer ${auth.token}',
        },
      );
      if (resp.statusCode != 200) return;
      final j = jsonDecode(resp.body);
      final act = (j['act'] as Map?) ?? {};

      _nameCtrl.text = (act['name'] ?? '').toString();
      _emailCtrl.text = (act['eMailAddr'] ?? '').toString();
      final ht = (act['homeTown'] ?? '').toString();
      if (ht.isNotEmpty) _prefilledHomeTown = ht;

      // Pull creator/owner names & ids (supports both naming variants)
      _creatorName =
          (act['createdByName'] ?? act['userCreateName'] ?? '').toString();
      _ownerName =
          (act['ownedByName'] ?? act['userOwnerName'] ?? '').toString();
      _ownerId = (act['userOwnerId'] ?? '').toString();

      if (mounted) setState(() {});
    } catch (_) {
      // soft fail; keep whatever is there
    }
  }

  Future<List<TownSuggestion>> _fetchTownSuggestions(String query) async {
    if (query.trim().length < 3) return const [];
    final auth = context.read<AuthProvider>();
    final uri = Uri.parse('$_apiBase$_townsSuggestPath')
        .replace(queryParameters: {'q': query.trim(), 'limit': '10'});

    try {
      final resp = await http.get(
        uri,
        headers: {
          'Content-Type': 'application/json',
          if (auth.token != null) 'Authorization': 'Bearer ${auth.token}',
        },
      );
      if (resp.statusCode != 200) return const [];
      final json = jsonDecode(resp.body);
      final List list = (json['data'] as List?) ?? const [];
      return list.map((e) => TownSuggestion.fromJson(e)).toList();
    } catch (_) {
      return const [];
    }
  }

  Future<void> _submit() async {
    final form = _formKey.currentState;
    if (form == null) return;
    if (!form.validate()) return;

    setState(() => _submitting = true);
    final auth = context.read<AuthProvider>();

    final uid = auth.userId ?? auth.user?['_id'] ?? auth.user?['userId'];

    // Build payload
    final body = <String, dynamic>{
      'name': _nameCtrl.text.trim(),
      if (_emailCtrl.text.trim().isNotEmpty)
        'eMailAddr': _emailCtrl.text.trim(),
      if (_prefilledHomeTown != null && _prefilledHomeTown!.isNotEmpty)
        'homeTown': _prefilledHomeTown
      else if (_selectedTown != null)
        'townId': _selectedTown!.id
      else
        'homeTown': _homeTownCtrl.text.trim(),
      if (uid != null) 'userOwnerId': uid,
      if (!_isUpdate && uid != null) 'userCreateId': uid,
    };

    final uri = _isUpdate
        ? Uri.parse('$_apiBase/acts/$_actId')
        : Uri.parse('$_apiBase/acts');

    try {
      final resp = await (_isUpdate
          ? http.put(
              uri,
              headers: {
                'Content-Type': 'application/json',
                if (auth.token != null) 'Authorization': 'Bearer ${auth.token}',
              },
              body: jsonEncode(body),
            )
          : http.post(
              uri,
              headers: {
                'Content-Type': 'application/json',
                if (auth.token != null) 'Authorization': 'Bearer ${auth.token}',
              },
              body: jsonEncode(body),
            ));

      final ok = _isUpdate ? 200 : 201;
      if (resp.statusCode == ok) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text(_isUpdate ? 'Act updated ✅' : 'Act created ✅')),
        );
        Navigator.of(context).pop(true);
      } else {
        final msg = _safeErr(resp.body);
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text('${_isUpdate ? "Update" : "Create"} failed: $msg')),
        );
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Network error: $e')),
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  String _safeErr(String body) {
    try {
      final j = jsonDecode(body);
      return j['error']?.toString() ?? 'Unknown error';
    } catch (_) {
      return body;
    }
  }

  void _onClaim() {
    // Placeholder for future wiring
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Claim requested (to be implemented)')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return PageWrapper(
      child: Column(
        children: [
          const LogoMenuBar(),
          const SizedBox(height: 12),
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 600),
              child: RoundedCard(
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: _buildForm(context),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildForm(BuildContext context) {
    final theme = Theme.of(context);
    final currentUid = context.watch<AuthProvider>().userId;

    return Form(
      key: _formKey,
      child: Shortcuts(
        shortcuts: <LogicalKeySet, Intent>{
          LogicalKeySet(LogicalKeyboardKey.enter): const ActivateIntent(),
          LogicalKeySet(LogicalKeyboardKey.numpadEnter): const ActivateIntent(),
        },
        child: Actions(
          actions: <Type, Action<Intent>>{
            ActivateIntent: CallbackAction<ActivateIntent>(
              onInvoke: (intent) {
                if (!_submitting) _submit();
                return null;
              },
            ),
          },
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(_isUpdate ? 'Edit Act' : 'Create Act',
                  style: theme.textTheme.titleLarge),
              const SizedBox(height: 12),

              // ----- Hometown row + Ownership info (right) -----
              if (_prefilledHomeTown != null &&
                  _prefilledHomeTown!.isNotEmpty) ...[
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Left: hometown label/value
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Hometown',
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: theme.colorScheme.onSurface
                                    .withOpacity(0.7),
                                fontWeight: FontWeight.w500,
                              )),
                          const SizedBox(height: 2),
                          Text(
                            _prefilledHomeTown!,
                            style: theme.textTheme.titleSmall?.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 16),
                    // Right: ownership info
                    OwnershipInfo(
                      creatorName: _creatorName,
                      ownerName: _ownerName,
                      showClaimButton: (_ownerId != null &&
                          currentUid != null &&
                          _ownerId != currentUid),
                      onClaim: _onClaim,
                    ),
                  ],
                ),
                const SizedBox(height: 16),
              ],

              // ----- Act Name -----
              TextFormField(
                controller: _nameCtrl,
                decoration: const InputDecoration(
                  labelText: 'Act Name *',
                  hintText: 'e.g., Stormbringer',
                  border: OutlineInputBorder(),
                ),
                textInputAction: TextInputAction.next,
                validator: (v) => (v == null || v.trim().isEmpty)
                    ? 'Act name is required'
                    : null,
                autofillHints: const <String>[],
                enableSuggestions: true,
                autocorrect: true,
              ),
              const SizedBox(height: 12),

              // ----- Email (optional) -----
              TextFormField(
                controller: _emailCtrl,
                decoration: const InputDecoration(
                  labelText: 'Contact Email (optional)',
                  hintText: 'act@example.com',
                  border: OutlineInputBorder(),
                ),
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                autofillHints: const [AutofillHints.email],
              ),
              const SizedBox(height: 12),

              // ----- Editable Hometown (only if not prefilled) -----
              if (_prefilledHomeTown == null ||
                  _prefilledHomeTown!.isEmpty) ...[
                _HometownAutocomplete(
                  controller: _homeTownCtrl,
                  fetcher: _fetchTownSuggestions,
                  onSelected: (town) => _selectedTown = town,
                  onTextChanged: () => _selectedTown = null,
                ),
                const SizedBox(height: 12),
              ],

              const SizedBox(height: 8),

              // ----- Buttons (right-justified; dominant far right) -----
              PageButtonsRow(
                secondaryActions: [
                  TextButton(
                    onPressed: _submitting
                        ? null
                        : () => Navigator.of(context).maybePop(),
                    child: const Text('Cancel'),
                  ),
                ],
                primaryAction: ElevatedButton(
                  onPressed: _submitting ? null : _submit,
                  child: _submitting
                      ? const SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(_isUpdate ? 'Update Act' : 'Create Act'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// --- Town Suggestion Model ---
class TownSuggestion {
  final String id;
  final String name;
  final String state;
  final double? lat;
  final double? lng;

  TownSuggestion({
    required this.id,
    required this.name,
    required this.state,
    this.lat,
    this.lng,
  });

  String get display => '$name, $state';

  factory TownSuggestion.fromJson(Map<String, dynamic> j) {
    return TownSuggestion(
      id: (j['id'] ?? j['_id']).toString(),
      name: (j['name'] ?? '').toString(),
      state: (j['state'] ?? '').toString(),
      lat: j['lat'] is num ? (j['lat'] as num).toDouble() : null,
      lng: j['lng'] is num ? (j['lng'] as num).toDouble() : null,
    );
  }
}

// --- Autocomplete (uses stable FocusNode + dispose) ---
class _HometownAutocomplete extends StatefulWidget {
  final TextEditingController controller;
  final Future<List<TownSuggestion>> Function(String) fetcher;
  final void Function(TownSuggestion) onSelected;
  final VoidCallback onTextChanged;

  const _HometownAutocomplete({
    required this.controller,
    required this.fetcher,
    required this.onSelected,
    required this.onTextChanged,
  });

  @override
  State<_HometownAutocomplete> createState() => _HometownAutocompleteState();
}

class _HometownAutocompleteState extends State<_HometownAutocomplete> {
  final _focusNode = FocusNode();
  List<TownSuggestion> _options = const [];

  @override
  void dispose() {
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return RawAutocomplete<TownSuggestion>(
      textEditingController: widget.controller,
      focusNode: _focusNode,
      optionsBuilder: (TextEditingValue tev) async {
        final q = tev.text;
        if (q.trim().length < 3) return const [];
        final results = await widget.fetcher(q);
        _options = results;
        return _options;
      },
      displayStringForOption: (opt) => opt.display,
      onSelected: (opt) {
        widget.controller.text = opt.display;
        widget.onSelected(opt);
      },
      fieldViewBuilder: (context, textEditingController, focusNode, _) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextFormField(
              controller: textEditingController,
              focusNode: focusNode,
              decoration: const InputDecoration(
                labelText: 'Hometown *',
                hintText: 'City, ST (or pick from suggestions)',
                border: OutlineInputBorder(),
              ),
              textInputAction: TextInputAction.done,
              validator: (v) => (v == null || v.trim().isEmpty)
                  ? 'Hometown is required'
                  : null,
              onChanged: (_) => widget.onTextChanged(),
              autofillHints: const <String>[],
              enableSuggestions: true,
              autocorrect: true,
            ),
          ],
        );
      },
      optionsViewBuilder: (context, onSelected, options) {
        final list = options.toList();
        if (list.isEmpty) return const SizedBox.shrink();
        return Align(
          alignment: Alignment.topLeft,
          child: Material(
            elevation: 4,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 600, maxHeight: 240),
              child: ListView.separated(
                padding: EdgeInsets.zero,
                itemCount: list.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final town = list[index];
                  return ListTile(
                    title: Text(town.display),
                    onTap: () => onSelected(town),
                  );
                },
              ),
            ),
          ),
        );
      },
    );
  }
}
