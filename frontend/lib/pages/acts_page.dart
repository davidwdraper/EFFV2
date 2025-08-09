import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_typeahead/flutter_typeahead.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../widgets/scaffold_wrapper.dart';
import '../widgets/rounded_card.dart';
import '../models/town_option.dart';
import '../widgets/town_picker.dart';
import '../pages/login_page.dart';

class ActOption {
  final String id;
  final String name;
  final String homeTown;
  final double distanceMeters;

  ActOption({
    required this.id,
    required this.name,
    required this.homeTown,
    required this.distanceMeters,
  });

  factory ActOption.fromJson(Map<String, dynamic> j) {
    return ActOption(
      id: (j['id'] ?? j['_id'] ?? '').toString(),
      name: (j['name'] ?? '').toString(),
      homeTown: (j['homeTown'] ?? '').toString(),
      distanceMeters: (j['distanceMeters'] is num)
          ? (j['distanceMeters'] as num).toDouble()
          : 0.0,
    );
  }
}

class ActsPage extends StatefulWidget {
  final String apiBase;
  const ActsPage({super.key, required this.apiBase});

  @override
  State<ActsPage> createState() => _ActsPageState();
}

class _ActsPageState extends State<ActsPage> {
  final TextEditingController _hometownController = TextEditingController();
  final TextEditingController _actSearchController = TextEditingController();

  // focus node so we can clear ≤ 12 list on new town entry
  final FocusNode _townFocusNode = FocusNode();

  TownOption? _selectedTown;

  bool _checkingTownActs = false;
  bool _showAllForTown = false;
  List<ActOption> _allTownActs = const [];

  @override
  void initState() {
    super.initState();
    _townFocusNode.addListener(() {
      if (_townFocusNode.hasFocus) {
        setState(() {
          _showAllForTown = false;
          _allTownActs = const [];
        });
      }
    });
  }

  @override
  void dispose() {
    _townFocusNode.dispose();
    _hometownController.dispose();
    _actSearchController.dispose();
    super.dispose();
  }

  Map<String, String> _authHeaders() {
    final auth = context.read<AuthProvider>();
    final headers = <String, String>{'Content-Type': 'application/json'};
    if (auth.jwt?.isNotEmpty == true) {
      headers['Authorization'] = 'Bearer ${auth.jwt}';
    }
    return headers;
  }

  Future<void> _checkAllForSelectedTown() async {
    final town = _selectedTown;
    if (town == null) return;

    setState(() {
      _checkingTownActs = true;
      _showAllForTown = false;
      _allTownActs = const [];
    });

    try {
      final uri = Uri.parse('${widget.apiBase}/acts/by-hometown').replace(
        queryParameters: {
          'lat': town.lat.toString(),
          'lng': town.lng.toString(),
          'q': '',
          'limit': '20',
        },
      );

      final res = await http.get(uri, headers: _authHeaders());
      if (res.statusCode == 200) {
        final body = jsonDecode(res.body);
        final status = (body is Map && body['status'] is String)
            ? (body['status'] as String)
            : '';
        if (status.toLowerCase() == 'all' && body['items'] is List) {
          final items = (body['items'] as List)
              .whereType<Map<String, dynamic>>()
              .map((e) => ActOption.fromJson(e))
              .toList()
            ..sort(
                (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
          setState(() {
            _showAllForTown = true;
            _allTownActs = items;
          });
        }
      }
    } catch (_) {
      // ignore errors → fallback
    } finally {
      if (mounted) {
        setState(() => _checkingTownActs = false);
      }
    }
  }

  Future<List<ActOption>> _fetchActsForTownLegacy({
    required TownOption town,
    required String pattern,
    int limit = 20,
  }) async {
    final q = pattern.trim();
    if (q.length < 3) return [];
    final uri = Uri.parse('${widget.apiBase}/acts/search').replace(
      queryParameters: {
        'lat': town.lat.toString(),
        'lng': town.lng.toString(),
        'q': q,
        'limit': limit.toString(),
      },
    );

    try {
      final res = await http.get(uri, headers: _authHeaders());
      if (res.statusCode != 200) return [];
      final body = jsonDecode(res.body);
      final data = (body is Map && body['data'] is List) ? body['data'] : [];
      return (data as List)
          .map<ActOption>((e) => ActOption.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> _ensureLoggedIn() async {
    final auth = context.read<AuthProvider>();
    if (!auth.isAuthenticated) {
      await Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => const LoginPage()),
      );
      await auth.checkToken();
    }
  }

  Future<void> _goToCreateAct() async {
    await _ensureLoggedIn();
    final auth = context.read<AuthProvider>();
    if (!auth.isAuthenticated) return;

    final name = _actSearchController.text.trim();
    final town = _selectedTown;
    if (name.isEmpty || town == null) return;

    final created = await Navigator.of(context).pushNamed(
      '/acts/new',
      arguments: {
        'prefillName': name,
        'prefillHomeTown': town.label,
        'jwt': auth.jwt,
      },
    );

    if (created == true && mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Act created')));
      _actSearchController.clear();
      setState(() {});
    }
  }

  Future<void> _editAct(ActOption act) async {
    await _ensureLoggedIn();
    final auth = context.read<AuthProvider>();
    if (!auth.isAuthenticated) return;

    final updated = await Navigator.of(context).pushNamed(
      '/acts/new',
      arguments: {
        'actId': act.id,
        'prefillName': act.name,
        'prefillHomeTown': act.homeTown,
        'jwt': auth.jwt,
      },
    );

    if (updated == true && mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Act updated')));
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    context.watch<AuthProvider>();

    return ScaffoldWrapper(
      title: null,
      contentPadding: const EdgeInsets.all(4),
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          RoundedCard(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Acts',
                    style:
                        TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                const SizedBox(height: 10),
                TownPicker(
                  apiBase: widget.apiBase,
                  controller: _hometownController,
                  focusNode: _townFocusNode,
                  onSelected: (town) {
                    setState(() {
                      _selectedTown = town;
                      _hometownController.text = town.label;
                      _actSearchController.clear();
                    });
                    _checkAllForSelectedTown();
                  },
                ),
                const SizedBox(height: 12),
                if (_selectedTown != null) ...[
                  if (_checkingTownActs)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 8),
                      child: Row(
                        children: [
                          SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                          SizedBox(width: 12),
                          Text('Checking acts…'),
                        ],
                      ),
                    )
                  else if (_showAllForTown)
                    Material(
                      type: MaterialType.card,
                      elevation: 4,
                      borderRadius: BorderRadius.circular(8),
                      child: ListView.separated(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        itemCount: _allTownActs.length,
                        separatorBuilder: (_, __) =>
                            const Divider(height: 1, indent: 12, endIndent: 12),
                        itemBuilder: (context, i) {
                          final act = _allTownActs[i];
                          return ListTile(
                            dense: true,
                            title: Text(act.name),
                            subtitle: Text(act.homeTown),
                            onTap: () => _editAct(act),
                          );
                        },
                      ),
                    )
                  else
                    TypeAheadField<ActOption>(
                      controller: _actSearchController,
                      suggestionsCallback: (pattern) => _fetchActsForTownLegacy(
                          town: _selectedTown!, pattern: pattern),
                      debounceDuration: const Duration(milliseconds: 200),
                      decorationBuilder: (context, child) => Material(
                        type: MaterialType.card,
                        elevation: 4,
                        borderRadius: BorderRadius.circular(8),
                        child: child,
                      ),
                      constraints: const BoxConstraints(maxHeight: 280),
                      offset: const Offset(0, 8),
                      itemBuilder: (context, suggestion) {
                        final miles = suggestion.distanceMeters / 1609.34;
                        return ListTile(
                          dense: true,
                          title: Text(suggestion.name),
                          subtitle: Text(
                              '${suggestion.homeTown} • ${miles.toStringAsFixed(1)} mi'),
                          onTap: () => _editAct(suggestion),
                        );
                      },
                      onSelected: _editAct,
                      builder: (context, controller, focusNode) => TextField(
                        controller: controller,
                        focusNode: focusNode,
                        decoration: const InputDecoration(
                          labelText: 'Search Act Name (3+ chars)',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      emptyBuilder: (context) => Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('No Acts Found!'),
                          TextButton.icon(
                            onPressed: _goToCreateAct,
                            icon: const Icon(Icons.add),
                            label: const Text('Add'),
                          ),
                        ],
                      ),
                      loadingBuilder: (context) => const Padding(
                        padding: EdgeInsets.all(12),
                        child: Row(
                          children: [
                            SizedBox(
                              height: 18,
                              width: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                            SizedBox(width: 12),
                            Text('Searching…'),
                          ],
                        ),
                      ),
                    ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
