import 'package:flutter/material.dart';
import 'package:flutter_typeahead/flutter_typeahead.dart';
import '../widgets/page_wrapper.dart';
import '../widgets/rounded_card.dart';

class ActsPage extends StatefulWidget {
  const ActsPage({super.key});

  @override
  State<ActsPage> createState() => _ActsPageState();
}

class _ActsPageState extends State<ActsPage> {
  final TextEditingController _hometownController = TextEditingController();
  final TextEditingController _searchController = TextEditingController();

  final List<String> hometowns = [
    'Austin, TX',
    'New York, NY',
    'New Smyrna Beach',
    'Chicago, IL',
  ];

  @override
  Widget build(BuildContext context) {
    return PageWrapper(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 600),
          child: RoundedCard(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Acts',
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 24),

                  /// ✅ Hometown selector with correct controller binding
                  TypeAheadField<String>(
                    controller: _hometownController,
                    suggestionsCallback: (pattern) async {
                      if (pattern.length < 3) return [];
                      return hometowns
                          .where((town) => town
                              .toLowerCase()
                              .contains(pattern.toLowerCase()))
                          .toList();
                    },
                    itemBuilder: (context, String suggestion) {
                      return ListTile(title: Text(suggestion));
                    },
                    onSelected: (String suggestion) {
                      // This updates the controller used by the field itself
                      _hometownController.text = suggestion;
                    },
                    builder: (context, controller, focusNode) {
                      // Use the same controller that onSelected updates
                      return TextField(
                        controller: _hometownController,
                        focusNode: focusNode,
                        decoration: const InputDecoration(
                          labelText: 'Hometown',
                          border: OutlineInputBorder(),
                          contentPadding: EdgeInsets.symmetric(
                              horizontal: 12, vertical: 14),
                        ),
                      );
                    },
                  ),

                  const SizedBox(height: 16),

                  /// Act search field with Search button
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _searchController,
                          decoration: const InputDecoration(
                            labelText: 'Search Act Name',
                            border: OutlineInputBorder(),
                            contentPadding: EdgeInsets.symmetric(
                                horizontal: 12, vertical: 14),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      ElevatedButton.icon(
                        onPressed: () {
                          debugPrint(
                              'Searching for: ${_searchController.text}');
                          // TODO: Wire search or "add new" logic
                        },
                        icon: const Icon(Icons.search),
                        label: const Text('Search'),
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
