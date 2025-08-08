// lib/pages/act_form_page.dart
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:http/http.dart' as http;

import '../providers/auth_provider.dart';
import '../widgets/logo_menu_bar.dart';
import '../widgets/page_wrapper.dart';
import '../widgets/rounded_card.dart';

class ActFormArgs {
  final String? prefillName;
  final String? prefillHomeTown;
  const ActFormArgs({this.prefillName, this.prefillHomeTown});
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

  TownSuggestion? _selectedTown;
  bool _submitting = false;

  // Match main.dart
  String get _apiBase => const String.fromEnvironment(
        'EFF_API_BASE',
        defaultValue: 'http://localhost:4000',
      );
  static const String _townsSuggestPath = '/towns/search'; // ?q=&limit=10

  @override
  void initState() {
    super.initState();
    final a = widget.args;

    // Prefill name immediately
    final prefillName = (a?.prefillName ?? '').trim();
    if (prefillName.isNotEmpty) {
      _nameCtrl.text = prefillName;
    }

    // Prefill hometown AFTER first frame so RawAutocomplete/TextField doesn't overwrite it
    final prefillTown = (a?.prefillHomeTown ?? '').trim();
    if (prefillTown.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _homeTownCtrl.text = prefillTown;
        setState(() {}); // ensure repaint with value present
      });
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _emailCtrl.dispose();
    _homeTownCtrl.dispose();
    super.dispose();
    // (Autocomplete focus node is disposed inside its own State)
  }

  Future<List<TownSuggestion>> _fetchTownSuggestions(String query) async {
    if (query.trim().length < 3) return const [];
    final auth = context.read<AuthProvider>();
    final uri = Uri.parse('$_apiBase$_townsSuggestPath').replace(
      queryParameters: {'q': query.trim(), 'limit': '10'},
    );

    try {
      final resp = await http.get(
        uri,
        headers: {
          'Content-Type': 'application/json',
          if (auth.jwtToken != null) 'Authorization': 'Bearer ${auth.jwtToken}',
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

    final uid = auth.user?['_id'] ?? auth.user?['userId'];

    final body = <String, dynamic>{
      'name': _nameCtrl.text.trim(),
      if (_emailCtrl.text.trim().isNotEmpty)
        'eMailAddr': _emailCtrl.text.trim(),
      if (_selectedTown != null)
        'townId': _selectedTown!.id
      else
        'homeTown': _homeTownCtrl.text.trim(),
      if (uid != null) 'userCreateId': uid,
      if (uid != null) 'userOwnerId': uid,
    };

    final uri = Uri.parse('$_apiBase/acts');

    try {
      final resp = await http.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          if (auth.jwtToken != null) 'Authorization': 'Bearer ${auth.jwtToken}',
        },
        body: jsonEncode(body),
      );

      if (resp.statusCode == 201) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Act created ✅')),
        );
        Navigator.of(context).pop(true);
      } else {
        final msg = _safeErr(resp.body);
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Create failed: $msg')),
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
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Create Act', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 16),

          // Act Name
          TextFormField(
            controller: _nameCtrl,
            decoration: const InputDecoration(
              labelText: 'Act Name *',
              hintText: 'e.g., Stormbringer',
              border: OutlineInputBorder(),
            ),
            textInputAction: TextInputAction.next,
            validator: (v) =>
                (v == null || v.trim().isEmpty) ? 'Act name is required' : null,
          ),
          const SizedBox(height: 12),

          // Email (optional)
          TextFormField(
            controller: _emailCtrl,
            decoration: const InputDecoration(
              labelText: 'Contact Email (optional)',
              hintText: 'act@example.com',
              border: OutlineInputBorder(),
            ),
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.next,
          ),
          const SizedBox(height: 12),

          // Hometown with typeahead
          _HometownAutocomplete(
            controller: _homeTownCtrl,
            fetcher: _fetchTownSuggestions,
            onSelected: (town) => _selectedTown = town,
            onTextChanged: () => _selectedTown = null,
          ),

          const SizedBox(height: 20),

          Row(
            children: [
              ElevatedButton(
                onPressed: _submitting ? null : _submit,
                child: _submitting
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Create Act'),
              ),
              const SizedBox(width: 12),
              TextButton(
                onPressed:
                    _submitting ? null : () => Navigator.of(context).maybePop(),
                child: const Text('Cancel'),
              ),
            ],
          ),
        ],
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
