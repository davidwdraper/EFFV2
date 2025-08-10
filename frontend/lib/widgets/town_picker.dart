import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_typeahead/flutter_typeahead.dart';
import 'package:http/http.dart' as http;
import '../models/town_option.dart';

class TownPicker extends StatelessWidget {
  final String apiBase;
  final TextEditingController controller;
  final TownOption? initial;
  final void Function(TownOption) onSelected;
  final String label;
  final VoidCallback? onFieldTap; // notify parent when field gets focus/tapped

  const TownPicker({
    super.key,
    required this.apiBase,
    required this.controller,
    required this.onSelected,
    this.initial,
    this.label = 'Hometown (... or nearest)',
    this.onFieldTap,
  });

  Future<List<TownOption>> _fetch(String pattern) async {
    final q = pattern.trim();
    if (q.length < 3) return [];
    final uri = Uri.parse('$apiBase/towns/typeahead')
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
    } catch (_) {
      return [];
    }
  }

  @override
  Widget build(BuildContext context) {
    return TypeAheadField<TownOption>(
      controller: controller,
      suggestionsCallback: _fetch,
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
      itemBuilder: (context, TownOption suggestion) {
        return ListTile(
          dense: true, // compact rows
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          title: Text(
            suggestion.label,
            style: const TextStyle(fontSize: 14),
          ),
        );
      },
      onSelected: onSelected,
      builder: (context, fieldController, fieldFocusNode) {
        return TextField(
          controller: fieldController,
          focusNode: fieldFocusNode, // TypeAhead manages focus
          onTap: onFieldTap, // parent clears ≤ 12 list on tap
          decoration: InputDecoration(
            labelText: label,
            border: const OutlineInputBorder(),
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
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
        child: Text('No towns found. Keep typing (3+ characters)…'),
      ),
      errorBuilder: (context, error) => Padding(
        padding: const EdgeInsets.all(12),
        child: Text('Error: $error', style: TextStyle(color: Colors.red)),
      ),
    );
  }
}
