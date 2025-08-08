// lib/pages/acts_page.dart
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_typeahead/flutter_typeahead.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart'; // ✅ NEW

import '../providers/auth_provider.dart'; // ✅ NEW
import '../widgets/scaffold_wrapper.dart';
import '../widgets/rounded_card.dart';
import '../models/town_option.dart';
import '../widgets/town_picker.dart';
import 'package:easy_fun_finder_flutter/pages/act_form_page.dart'
    show ActFormPage, ActFormArgs;

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
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>(); // ✅ check auth

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
                if (_selectedTown != null)
                  TypeAheadField<ActOption>(
                    controller: _actSearchController,
                    suggestionsCallback: (pattern) => _fetchActsForTown(
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
                        onTap: () {
                          debugPrint(
                              'Selected Act: ${suggestion.name} (${suggestion.id})');
                        },
                      );
                    },
                    onSelected: (ActOption selection) {
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
                          if (auth.isAuthenticated) // ✅ Only show if logged in
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
