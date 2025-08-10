// lib/pages/acts_page.dart
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
  static const double _listMaxHeight = 280.0;
  static const int _fallbackLimit = 20;
  static const int _allActsPracticalCap = 1000;
  static const int _minChars = 3;
  static const int _radiusMiles = 50;

  final TextEditingController _hometownController = TextEditingController();
  final TextEditingController _actSearchController = TextEditingController();

  TownOption? _selectedTown;

  bool _checkingTownActs = false;
  bool _showAllForTown = false;
  List<ActOption> _allTownActs = const [];

  @override
  void dispose() {
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
          'miles': '$_radiusMiles',
          'limit': '$_allActsPracticalCap',
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
              (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
            );

          // Only show the ≤12 panel when there are actual items
          if (items.isNotEmpty) {
            setState(() {
              _showAllForTown = true;
              _allTownActs = items;
            });
          } else {
            setState(() {
              _showAllForTown = false;
              _allTownActs = const [];
            });
          }
        } else {
          setState(() {
            _showAllForTown = false;
            _allTownActs = const [];
          });
        }
      } else {
        setState(() {
          _showAllForTown = false;
          _allTownActs = const [];
        });
      }
    } catch (_) {
      setState(() {
        _showAllForTown = false;
        _allTownActs = const [];
      });
    } finally {
      if (mounted) setState(() => _checkingTownActs = false);
    }
  }

  Future<List<ActOption>> _fetchActsForTownLegacy({
    required TownOption town,
    required String pattern,
    int limit = _fallbackLimit,
  }) async {
    final q = pattern.trim();
    if (q.length < _minChars) return [];
    final uri = Uri.parse('${widget.apiBase}/acts/search').replace(
      queryParameters: {
        'lat': town.lat.toString(),
        'lng': town.lng.toString(),
        'q': q,
        'limit': limit.toString(),
        'miles': '$_radiusMiles',
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
      // After creating, hide the ≤12 panel
      setState(() {
        _showAllForTown = false;
        _allTownActs = const [];
      });
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

  Widget _actNameInputRow({required bool enabled}) {
    final canAdd = enabled && _actSearchController.text.trim().isNotEmpty;
    return Row(
      children: [
        Expanded(
          child: TextField(
            controller: _actSearchController,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              labelText: 'Act Name',
              border: OutlineInputBorder(),
              contentPadding:
                  EdgeInsets.symmetric(horizontal: 12.0, vertical: 14.0),
            ),
          ),
        ),
        const SizedBox(width: 8.0),
        TextButton.icon(
          onPressed: canAdd ? _goToCreateAct : null,
          icon: const Icon(Icons.add),
          label: const Text('Add'),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    context.watch<AuthProvider>();

    return ScaffoldWrapper(
      title: null,
      contentPadding:
          const EdgeInsets.symmetric(horizontal: 4.0, vertical: 4.0),
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          RoundedCard(
            padding:
                const EdgeInsets.symmetric(horizontal: 12.0, vertical: 10.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'Acts',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  textAlign: TextAlign.left,
                ),
                const SizedBox(height: 10.0),

                // Hometown picker
                TownPicker(
                  apiBase: widget.apiBase,
                  controller: _hometownController,
                  onFieldTap: () {
                    if (_showAllForTown || _allTownActs.isNotEmpty) {
                      setState(() {
                        _showAllForTown = false;
                        _allTownActs = const [];
                      });
                    }
                  },
                  onSelected: (town) {
                    setState(() {
                      _selectedTown = town;
                      _hometownController.text = town.label;
                      _actSearchController.clear();
                    });
                    _checkAllForSelectedTown();
                  },
                ),

                const SizedBox(height: 12.0),

                if (_selectedTown != null) ...[
                  if (_checkingTownActs)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 8.0),
                      child: Row(
                        children: [
                          SizedBox(
                            height: 18.0,
                            width: 18.0,
                            child: CircularProgressIndicator(strokeWidth: 2.0),
                          ),
                          SizedBox(width: 12.0),
                          Text('Checking acts for this hometown…'),
                        ],
                      ),
                    )
                  else if (_showAllForTown) ...[
                    _actNameInputRow(enabled: true),
                    const SizedBox(height: 8.0),
                    ConstrainedBox(
                      constraints:
                          const BoxConstraints(maxHeight: _listMaxHeight),
                      child: Material(
                        type: MaterialType.card,
                        elevation: 4,
                        borderRadius: BorderRadius.circular(8),
                        child: ListView.separated(
                          padding: const EdgeInsets.symmetric(vertical: 4.0),
                          itemCount: _allTownActs.length,
                          separatorBuilder: (_, __) => const Divider(
                            height: 1.0,
                            indent: 12.0,
                            endIndent: 12.0,
                          ),
                          itemBuilder: (context, i) {
                            final act = _allTownActs[i];
                            return ListTile(
                              dense: true,
                              minVerticalPadding: 6.0,
                              title: Text(act.name),
                              subtitle: Text(act.homeTown),
                              onTap: () => _editAct(act),
                            );
                          },
                        ),
                      ),
                    ),
                  ] else
                    // When there are no acts to show, fall back to legacy typeahead
                    TypeAheadField<ActOption>(
                      controller: _actSearchController,
                      suggestionsCallback: (pattern) => _fetchActsForTownLegacy(
                        town: _selectedTown!,
                        pattern: pattern,
                        limit: _fallbackLimit,
                      ),
                      debounceDuration: const Duration(milliseconds: 200),
                      decorationBuilder: (context, child) {
                        return Material(
                          type: MaterialType.card,
                          elevation: 4,
                          borderRadius: BorderRadius.circular(8),
                          child: child,
                        );
                      },
                      constraints:
                          const BoxConstraints(maxHeight: _listMaxHeight),
                      offset: const Offset(0.0, 8.0),
                      itemBuilder: (context, ActOption suggestion) {
                        final miles = suggestion.distanceMeters / 1609.34;
                        return ListTile(
                          dense: true,
                          minVerticalPadding: 6.0,
                          title: Text(suggestion.name),
                          subtitle: Text(
                            '${suggestion.homeTown} • ${miles.toStringAsFixed(1)} mi',
                          ),
                          onTap: () => _editAct(suggestion),
                        );
                      },
                      onSelected: (ActOption selection) => _editAct(selection),
                      builder: (context, controller, focusNode) {
                        final canAdd = controller.text.trim().isNotEmpty &&
                            _selectedTown != null;
                        return TextField(
                          controller: controller,
                          focusNode: focusNode,
                          onChanged: (_) => setState(() {}),
                          decoration: InputDecoration(
                            labelText: 'Search Act Name (${_minChars}+ chars)',
                            border: const OutlineInputBorder(),
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: 12.0,
                              vertical: 14.0,
                            ),
                            suffixIcon: IconButton(
                              tooltip: 'Add',
                              onPressed: canAdd ? _goToCreateAct : null,
                              icon: const Icon(Icons.add),
                            ),
                          ),
                        );
                      },
                      emptyBuilder: (context) => const Padding(
                        padding: EdgeInsets.symmetric(
                            horizontal: 12.0, vertical: 8.0),
                        child: Text(
                            'No Acts Found. Type a name and tap + to add.'),
                      ),
                      loadingBuilder: (context) => const Padding(
                        padding: EdgeInsets.all(12.0),
                        child: Row(
                          children: [
                            SizedBox(
                              height: 18.0,
                              width: 18.0,
                              child:
                                  CircularProgressIndicator(strokeWidth: 2.0),
                            ),
                            SizedBox(width: 12.0),
                            Text('Searching…'),
                          ],
                        ),
                      ),
                      errorBuilder: (context, error) => Padding(
                        padding: const EdgeInsets.all(12.0),
                        child: Text(
                          'Error: $error',
                          style: const TextStyle(color: Colors.red),
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
