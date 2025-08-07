import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_typeahead/flutter_typeahead.dart';
import 'package:http/http.dart' as http;

import '../widgets/page_wrapper.dart';
import '../widgets/rounded_card.dart';
import '../models/town_option.dart'; // shared TownOption
import 'act_form_page.dart'; // for ActFormPage + ActFormArgs

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
  final String apiBase; // e.g. http://localhost:4000
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

  // ---------- API calls ----------
  Future<List<TownOption>> _fetchHometowns(String pattern) async {
    final q = pattern.trim();
    if (q.length < 3) return [];
    final uri = Uri.parse('${widget.apiBase}/towns/typeahead')
        .replace(queryParameters: {'q': q, 'limit': '20'});

    try {
      final res = await http.get(uri);
      if (res.statusCode != 200) return [];
      final body = jsonDecode(res.body);
      final list = (body is Map && body['data'] is List) ? body['data'] : body;
      if (list is! List) return [];
      return list
          .map<TownOption>(
              (e) => TownOption.fromJson(e as Map<String, dynamic>))
          .toList();
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

  // ---------- Navigation ----------
  Future<void> _goToCreateAct() async {
    final name = _actSearchController.text.trim();
    final town = _selectedTown;
    if (name.isEmpty || town == null) return;

    final createdId = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => ActFormPage(
          args: ActFormArgs(
            apiBase: widget.apiBase,
            town: town,
            initialName: name,
          ),
        ),
      ),
    );

    if (createdId != null && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Act created')),
      );
      _actSearchController.clear();
      setState(() {}); // if you later add a results list to refresh
    }
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
              crossAxisAlignment:
                  CrossAxisAlignment.start, // ← keep left alignment
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'Acts',
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                  textAlign: TextAlign.left,
                ),
                const SizedBox(height: 24),

                // ---------- Hometown selector (TypeAhead) ----------
                TypeAheadField<TownOption>(
                  controller: _hometownController,
                  suggestionsCallback: _fetchHometowns,
                  debounceDuration: const Duration(milliseconds: 200),
                  // v5 custom dropdown styling:
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
                    // Editable text field for hometown search
                    return TextField(
                      controller: controller,
                      focusNode: focusNode,
                      decoration: const InputDecoration(
                        labelText: 'Hometown (searches within radius)',
                        border: OutlineInputBorder(),
                        contentPadding: EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 14,
                        ),
                      ),
                    );
                  },
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
                  emptyBuilder: (context) => const Padding(
                    padding: EdgeInsets.all(8),
                    child: Text(
                      'No towns found. Keep typing (3+ characters)…',
                      style: TextStyle(fontSize: 14),
                    ),
                  ),
                  errorBuilder: (context, error) => Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text('Error: $error',
                        style: const TextStyle(color: Colors.red)),
                  ),
                ),

                const SizedBox(height: 16),

                // ---------- Act typeahead (only AFTER a hometown is selected) ----------
                if (_selectedTown != null)
                  TypeAheadField<ActOption>(
                    controller: _actSearchController,
                    suggestionsCallback: (pattern) => _fetchActsForTown(
                      town: _selectedTown!,
                      pattern: pattern,
                      limit: 20,
                    ),
                    debounceDuration: const Duration(milliseconds: 200),
                    // v5 custom dropdown styling:
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
                        onTap: () {
                          // TODO: Navigate to Act detail/form with suggestion.id
                          debugPrint(
                              'Selected Act: ${suggestion.name} (${suggestion.id})');
                        },
                      );
                    },
                    onSelected: (ActOption selection) {
                      debugPrint(
                          'User selected act: ${selection.name} (${selection.id})');
                      // TODO: Navigate to Act detail/form with selection.id
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
        ),
      ),
    );
  }
}
