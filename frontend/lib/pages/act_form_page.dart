import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../models/town_option.dart'; // ✅ use shared TownOption

/// Route args so navigation is clean and type-safe
class ActFormArgs {
  final String apiBase; // e.g. http://localhost:4000
  final TownOption town; // selected hometown
  final String initialName; // typed Act name
  ActFormArgs(
      {required this.apiBase, required this.town, required this.initialName});
}

class ActFormPage extends StatefulWidget {
  final ActFormArgs args;
  const ActFormPage({super.key, required this.args});

  @override
  State<ActFormPage> createState() => _ActFormPageState();
}

class _ActFormPageState extends State<ActFormPage> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  final TextEditingController _email = TextEditingController();

  // Backend requires actType (array of numbers). Replace with your real list.
  final List<int> _availableActTypes = const [0, 1, 2, 3];
  final List<int> _selectedTypes = [];

  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: widget.args.initialName);
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedTypes.isEmpty) {
      setState(() => _error = "Select at least one Act Type.");
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });

    final body = {
      "name": _name.text.trim(),
      "eMailAddr": _email.text.trim().isEmpty ? null : _email.text.trim(),
      "homeTown": widget.args.town.label, // "City, ST"
      "townId": widget.args.town.townId, // lets backend set geo
      "actType": _selectedTypes, // REQUIRED
    };

    try {
      final uri = Uri.parse('${widget.args.apiBase}/acts');
      final res = await http.post(
        uri,
        headers: {"Content-Type": "application/json"},
        body: jsonEncode(body),
      );

      if (res.statusCode == 201) {
        final data = jsonDecode(res.body);
        final createdId =
            (data['act']?['id'] ?? data['act']?['_id'] ?? '').toString();
        if (!mounted) return;
        Navigator.of(context).pop(createdId); // return ID to caller
        return;
      }

      if (res.statusCode == 409) {
        setState(() => _error =
            "An Act with this name in ${widget.args.town.label} already exists.");
      } else if (res.statusCode == 401) {
        setState(() => _error = "You must be signed in to create an Act.");
      } else {
        setState(() => _error = "Failed to create Act (${res.statusCode}).");
      }
    } catch (e) {
      setState(() => _error = "Network error: $e");
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Create Act")),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 600),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Form(
              key: _formKey,
              child: ListView(
                children: [
                  // Hometown (locked)
                  TextFormField(
                    readOnly: true,
                    initialValue: widget.args.town.label,
                    decoration: const InputDecoration(
                      labelText: "Hometown",
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),

                  // Name
                  TextFormField(
                    controller: _name,
                    decoration: const InputDecoration(
                      labelText: "Act Name",
                      border: OutlineInputBorder(),
                    ),
                    validator: (v) => (v == null || v.trim().isEmpty)
                        ? "Name is required"
                        : null,
                  ),
                  const SizedBox(height: 12),

                  // Email (optional)
                  TextFormField(
                    controller: _email,
                    decoration: const InputDecoration(
                      labelText: "Email (optional)",
                      border: OutlineInputBorder(),
                    ),
                    keyboardType: TextInputType.emailAddress,
                  ),
                  const SizedBox(height: 12),

                  // Act Types
                  const Text("Act Type (pick at least one)"),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 8,
                    children: _availableActTypes.map((t) {
                      final selected = _selectedTypes.contains(t);
                      return FilterChip(
                        label: Text("Type $t"),
                        selected: selected,
                        onSelected: (on) {
                          setState(() {
                            if (on) {
                              _selectedTypes.add(t);
                            } else {
                              _selectedTypes.remove(t);
                            }
                          });
                        },
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 16),

                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Text(_error!,
                          style: const TextStyle(color: Colors.red)),
                    ),

                  Row(
                    children: [
                      ElevatedButton(
                        onPressed: _submitting ? null : _submit,
                        child: _submitting
                            ? const SizedBox(
                                height: 18,
                                width: 18,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2))
                            : const Text("Create"),
                      ),
                      const SizedBox(width: 12),
                      TextButton(
                        onPressed: _submitting
                            ? null
                            : () => Navigator.of(context).pop(),
                        child: const Text("Cancel"),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
