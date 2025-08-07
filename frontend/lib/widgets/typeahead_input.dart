import 'package:flutter/material.dart';
import 'package:flutter_typeahead/flutter_typeahead.dart';

class TypeAheadInput extends StatelessWidget {
  final String label;
  final TextEditingController controller;
  final Future<List<String>> Function(String) suggestionsCallback;
  final void Function(String) onSelected;

  const TypeAheadInput({
    super.key,
    required this.label,
    required this.controller,
    required this.suggestionsCallback,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    return TypeAheadField<String>(
      controller: controller,
      suggestionsCallback: suggestionsCallback,
      itemBuilder: (context, suggestion) => ListTile(title: Text(suggestion)),
      onSelected: onSelected,
      builder: (context, fieldController, focusNode) {
        return TextField(
          controller: controller,
          focusNode: focusNode,
          decoration: InputDecoration(
            labelText: label,
            border: const OutlineInputBorder(),
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
          ),
        );
      },
    );
  }
}
