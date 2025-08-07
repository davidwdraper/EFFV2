import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_typeahead/flutter_typeahead.dart';
import 'package:http/http.dart' as http;

import '../widgets/page_wrapper.dart';
import '../widgets/rounded_card.dart';

/// ---------- Models (top-level) ----------
class TownOption {
  final String label; // "Austin, TX"
  final double lat;
  final double lng;
  final String townId;

  TownOption({
    required this.label,
    required this.lat,
    required this.lng,
    required this.townId,
  });

  factory TownOption.fromJson(Map<String, dynamic> j) {
    return TownOption(
      label: (j['label'] as String?) ??
          '${j['name'] as String}, ${j['state'] as String}',
      lat: (j['lat'] as num).toDouble(),
      lng: (j['lng'] as num).toDouble(),
      townId: j['townId']?.toString() ?? j['_id']?.toString() ?? '',
    );
  }

  @override
  String toString() => label;
}

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

/// ---------- Page ----------
class ActsPage extends StatefulWidget {
  const ActsPage({super.key});

  @override
  State<ActsPage> createState() => _ActsPageState();
}

class _ActsPageState extends State<ActsPage> {
  final TextEditingController _hometownController = TextEditingController();
  final TextEditingController _actSearchController = TextEditingController();

  TownOption? _selectedTown;

  // Backend base (orchestrator). Override with:
  // flutter run --dart-define=EFF_API_BASE=http://localhost:4000
  static const String _apiBase = String.fromEnvironment(
    'EFF_API_BASE',
    defaultValue: 'http://localhost:4000',
  );

  // -------- API calls --------
  Future<List<TownOption>> _fetchHometowns(String pattern) async {
    final q = pattern.trim();
    if (q.length < 3) return [];
    final uri = Uri.parse('$_apiBase/towns/typeahead')
        .replace(queryParameters: {'q': q});

    try {
      final res = await http.get(uri);
      if (res.statusCode != 200) return [];
      final body = jsonDecode(res.body);
      // Accept either { data: [] } or [] directly
      final list = (body is Map && body['data'] is List) ? body['data'] : body;
      if (list is! List) return [];
      return list.map<TownOption>((e) => TownOption.fromJson(e)).toList();
    } catch (e) {
      debugPrint('hometown fetch error: $e');
      return [];
    }
  }

  Future<List<ActOption>> _fetchActsForTown({
    required TownOption town,
    required String pattern,
    int limit = 20,
  }) async {
    final q = pattern.trim();
    if (q.length < 3) return [];
    final uri = Uri.parse('$_apiBase/acts/search').replace(queryParameters: {
      'lat': town.lat.toString(),
      'lng': town.lng.toString(),
      'q': q,
      'limit': limit.toString(),
    });

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

  @override
  void dispose() {
    _hometownController.dispose();
    _actSearchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return PageWrapper(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 600),
        child: RoundedCard(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'Acts',
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                  textAlign: TextAlign.left,
                ),
                const SizedBox(height: 24),

                // ---------- Hometown selector ----------
                TypeAheadField<TownOption>(
                  controller: _hometownController,
                  suggestionsCallback: _fetchHometowns,
                  itemBuilder: (context, TownOption suggestion) {
                    return ListTile(
                      title: Text(suggestion.label),
                      subtitle: Text(
                          'lat: ${suggestion.lat}, lng: ${suggestion.lng}'),
                    );
                  },
                  onSelected: (TownOption selection) {
                    setState(() {
                      _selectedTown = selection;
                      _hometownController.text = selection.label;
                      _actSearchController.clear();
                    });
                  },
                  builder: (context, controller, focusNode) {
                    return TextField(
                      controller: controller,
                      focusNode: focusNode,
                      decoration: const InputDecoration(
                        labelText: 'Hometown (searches within radius)',
                        border: OutlineInputBorder(),
                        contentPadding:
                            EdgeInsets.symmetric(horizontal: 12, vertical: 14),
                      ),
                    );
                  },
                  emptyBuilder: (context) => const Padding(
                    padding: EdgeInsets.all(8),
                    child: Text(
                      'No towns found. Keep typing (3+ characters)…',
                      style: TextStyle(fontSize: 14),
                    ),
                  ),
                ),

                const SizedBox(height: 16),

                // ---------- Act typeahead (after hometown) ----------
                if (_selectedTown != null)
                  TypeAheadField<ActOption>(
                    controller: _actSearchController,
                    suggestionsCallback: (pattern) async {
                      return _fetchActsForTown(
                        town: _selectedTown!,
                        pattern: pattern,
                        limit: 20,
                      );
                    },
                    itemBuilder: (context, ActOption suggestion) {
                      final miles = (suggestion.distanceMeters / 1609.34);
                      return ListTile(
                        title: Text(suggestion.name),
                        subtitle: Text(
                          '${suggestion.homeTown} • ${miles.toStringAsFixed(1)} mi',
                        ),
                        onTap: () {
                          // TODO: Navigate to Act detail/form with suggestion.id
                          debugPrint(
                              'Selected Act: ${suggestion.name} (${suggestion.id}) @ ${_selectedTown!.label}');
                        },
                      );
                    },
                    onSelected: (ActOption selection) {
                      // Same as onTap above, kept for clarity.
                      debugPrint(
                          'User selected act: ${selection.name} (${selection.id})');
                    },
                    builder: (context, controller, focusNode) {
                      return TextField(
                        controller: controller,
                        focusNode: focusNode,
                        decoration: const InputDecoration(
                          labelText: 'Search Act Name (3+ chars)',
                          border: OutlineInputBorder(),
                          contentPadding: EdgeInsets.symmetric(
                              horizontal: 12, vertical: 14),
                        ),
                      );
                    },
                    emptyBuilder: (context) => Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 8),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('No Acts Found!',
                              style: TextStyle(fontSize: 16)),
                          TextButton.icon(
                            onPressed: () {
                              final name = _actSearchController.text.trim();
                              if (name.isEmpty || _selectedTown == null) return;
                              // TODO: Navigate to "Create Act" form with prefilled
                              // name + hometown (townId & label).
                              debugPrint(
                                  'User wants to add: "$name" in ${_selectedTown!.label}');
                            },
                            icon: const Icon(Icons.add),
                            label: const Text('Add'),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
