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
  final TextEditingController _actSearchController = TextEditingController();

  String? _selectedHometown;

  final List<String> hometowns = [
    'Austin, TX',
    'New York, NY',
    'New Smyrna Beach',
    'Chicago, IL',
  ];

  final List<String> allActs = [
    'Stormbringer',
    'Neon Rain',
    'Velvet Vultures',
    'The Night Owls',
  ];

  List<String> _filterActs(String pattern) {
    return allActs
        .where((act) => act.toLowerCase().contains(pattern.toLowerCase()))
        .toList();
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

                // ✅ Hometown selector
                TypeAheadField<String>(
                  controller: _hometownController,
                  suggestionsCallback: (pattern) async {
                    if (pattern.length < 3) return [];
                    return hometowns
                        .where((town) =>
                            town.toLowerCase().contains(pattern.toLowerCase()))
                        .toList();
                  },
                  itemBuilder: (context, String suggestion) {
                    return ListTile(title: Text(suggestion));
                  },
                  onSelected: (String selection) {
                    setState(() {
                      _hometownController.text = selection;
                      _selectedHometown = selection;
                    });
                  },
                  builder: (context, controller, focusNode) {
                    return TextField(
                      controller: controller,
                      focusNode: focusNode,
                      decoration: const InputDecoration(
                        labelText: 'Hometown (Searches out 50 miles)',
                        border: OutlineInputBorder(),
                        contentPadding:
                            EdgeInsets.symmetric(horizontal: 12, vertical: 14),
                      ),
                    );
                  },
                ),
                const SizedBox(height: 16),

                // ✅ Act name search only appears after Hometown is selected
                if (_selectedHometown != null)
                  TypeAheadField<String>(
                    controller: _actSearchController,
                    suggestionsCallback: (pattern) async {
                      if (pattern.length < 3) return [];
                      return _filterActs(pattern);
                    },
                    itemBuilder: (context, String suggestion) {
                      return ListTile(
                        title: Text(suggestion),
                        onTap: () {
                          debugPrint('Selected Act: $suggestion');
                          // TODO: Navigate to Act Form
                        },
                      );
                    },
                    onSelected: (String selection) {
                      debugPrint('User selected act: $selection');
                      // TODO: Navigate to Act Form
                    },
                    builder: (context, controller, focusNode) {
                      return TextField(
                        controller: controller,
                        focusNode: focusNode,
                        decoration: const InputDecoration(
                          labelText: 'Search Act Name',
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
                          const Text(
                            'No Acts Found!',
                            style: TextStyle(fontSize: 16),
                          ),
                          TextButton.icon(
                            onPressed: () {
                              debugPrint(
                                  'User wants to add: ${_actSearchController.text}');
                              // TODO: Trigger Add New Act logic
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
