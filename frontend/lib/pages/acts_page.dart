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
import '../pages/login_page.dart'; // ✅ for auth gate on Add/Edit

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

  TownOption? _selectedTown;

  @override
  void dispose() {
    _hometownController.dispose();
    _actSearchController.dispose();
    super.dispose();
  }

  /// New: Smart suggestions.
  /// Ask backend if we should return ALL acts for this hometown (when total < 12).
  /// If backend returns { status: "all", items: [...] }, we return ALL (sorted by name).
  /// Otherwise we fall back to the existing /acts/search typeahead behavior.
  Future<List<ActOption>> _suggestActsForTown({
    required TownOption town,
    required String pattern,
    int limit = 20,
  }) async {
    final q = pattern.trim();

    // Try the new endpoint first. It decides whether to return all or to make us fall back.
    // Expected shapes:
    //   { status: "all", items: [...] }  → show all (sorted by name)
    //   { status: "limited" } or anything else → fall back to /acts/search below
    try {
      final uriAll = Uri.parse('${widget.apiBase}/acts/by-hometown').replace(
        queryParameters: {
          'lat': town.lat.toString(),
          'lng': town.lng.toString(),
          'q':
              q, // backend can choose to ignore q and return all when total < 12
          'limit': '$limit', // backend can ignore if returning all
        },
      );
      final resAll = await http.get(uriAll);
      if (resAll.statusCode == 200) {
        final body = jsonDecode(resAll.body);
        final status = (body is Map && body['status'] is String)
            ? (body['status'] as String)
            : '';
        if (status.toLowerCase() == 'all' && body['items'] is List) {
          final items = (body['items'] as List)
              .whereType<Map<String, dynamic>>()
              .map((e) => ActOption.fromJson(e))
              .toList();

          // Sort ALL by name (case-insensitive)
          items.sort(
              (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
          return items;
        }
        // else → fall through to legacy search
      }
    } catch (_) {
      // swallow and fall back
    }

    // Legacy behavior: require 3+ chars, use /acts/search (nearby + q + limit)
    if (q.length < 3) return [];
    return _fetchActsForTownLegacy(town: town, pattern: q, limit: limit);
  }

  Future<List<ActOption>> _fetchActsForTownLegacy({
    required TownOption town,
    required String pattern,
    int limit = 20,
  }) async {
    final q = pattern.trim();
    final uri = Uri.parse('${widget.apiBase}/acts/search').replace(
      queryParameters: {
        'lat': town.lat.toString(),
        'lng': town.lng.toString(),
        'q': q,
        'limit': limit.toString(),
      },
    );

    try {
      final res = await http.get(uri);
      if (res.statusCode != 200) return [];
      final body = jsonDecode(res.body);
      final data = (body is Map && body['data'] is List) ? body['data'] : [];
      return (data as List)
          .map<ActOption>((e) => ActOption.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (e) {
      debugPrint('act search error: $e');
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

    // ⬇️ Map-based arguments (no ActFormArgs)
    final created = await Navigator.of(context).pushNamed(
      '/acts/new', // keep your existing route
      arguments: {
        'prefillName': name,
        'prefillHomeTown': town.label,
        'jwt': auth.jwt, // optional; ActFormPage can read it if needed
      },
    );

    if (created == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Act created')),
      );
      _actSearchController.clear();
      setState(() {});
    }
  }

  Future<void> _editAct(ActOption act) async {
    await _ensureLoggedIn();
    final auth = context.read<AuthProvider>();
    if (!auth.isAuthenticated) return;

    // ⬇️ Map-based arguments (no ActFormArgs)
    final updated = await Navigator.of(context).pushNamed(
      '/acts/new', // same route; ActFormPage can treat presence of actId as "edit"
      arguments: {
        'actId': act.id,
        'prefillName': act.name,
        'prefillHomeTown': act.homeTown,
        'jwt': auth.jwt, // optional
      },
    );

    if (updated == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Act updated')),
      );
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    // just to rebuild when auth state changes (e.g., after login return)
    context.watch<AuthProvider>();

    return ScaffoldWrapper(
      title: null,
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          RoundedCard(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'Acts',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  textAlign: TextAlign.left,
                ),
                const SizedBox(height: 10),

                // Hometown picker
                // Note: If TownPicker currently shows lat/lng in its dropdown,
                // that formatting lives inside TownPicker. I can remove it there next.
                TownPicker(
                  apiBase: widget.apiBase,
                  controller: _hometownController,
                  onSelected: (town) {
                    setState(() {
                      _selectedTown = town;
                      _hometownController.text = town.label;
                      _actSearchController.clear();
                    });
                  },
                ),

                const SizedBox(height: 12),

                // Act name search (smart logic: ALL results if hometown total < 12)
                if (_selectedTown != null)
                  TypeAheadField<ActOption>(
                    controller: _actSearchController,
                    suggestionsCallback: (pattern) => _suggestActsForTown(
                      town: _selectedTown!,
                      pattern: pattern,
                      limit: 20,
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
                    constraints: const BoxConstraints(maxHeight: 280),
                    offset: const Offset(0, 8),
                    itemBuilder: (context, ActOption suggestion) {
                      final miles = suggestion.distanceMeters / 1609.34;
                      return ListTile(
                        title: Text(suggestion.name),
                        subtitle: Text(
                          '${suggestion.homeTown} • ${miles.toStringAsFixed(1)} mi',
                        ),
                        onTap: () => _editAct(suggestion), // 👈 edit flow
                      );
                    },
                    onSelected: (ActOption selection) {
                      _editAct(selection); // also handle keyboard selection
                    },
                    builder: (context, controller, focusNode) {
                      return TextField(
                        controller: controller,
                        focusNode: focusNode,
                        decoration: const InputDecoration(
                          labelText: 'Search Act Name',
                          border: OutlineInputBorder(),
                          contentPadding: EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 14,
                          ),
                        ),
                      );
                    },
                    // Always show Add; auth handled on click
                    emptyBuilder: (context) => Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 8),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('No Acts Found!',
                              style: TextStyle(fontSize: 16)),
                          TextButton.icon(
                            onPressed: _goToCreateAct,
                            icon: const Icon(Icons.add),
                            label: const Text('Add'),
                          ),
                        ],
                      ),
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
                    errorBuilder: (context, error) => Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text('Error: $error',
                          style: const TextStyle(color: Colors.red)),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
