import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../widgets/logo_menu_bar.dart';

class UserProfilePage extends StatelessWidget {
  const UserProfilePage({super.key});

  @override
  Widget build(BuildContext context) {
    final userName = context.watch<AuthProvider>().userDisplayName ?? 'User';

    return Scaffold(
      backgroundColor: Colors.grey[100],
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 600),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 8.0, vertical: 4.0),
                  child: LogoMenuBar(),
                ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    child: ListView(
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.center,
                          children: [
                            const CircleAvatar(
                              radius: 40,
                              backgroundImage: AssetImage('assets/default_avatar.png'),
                            ),
                            const SizedBox(width: 16),
                            Expanded(
                              child: Text(
                                userName,
                                style: Theme.of(context).textTheme.headlineSmall,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 32),
                        Wrap(
                          spacing: 12,
                          runSpacing: 12,
                          children: [
                            ElevatedButton.icon(
                              onPressed: () {}, // To be wired
                              icon: const Icon(Icons.add_photo_alternate),
                              label: const Text('Add Image'),
                            ),
                            ElevatedButton.icon(
                              onPressed: () {}, // To be wired
                              icon: const Icon(Icons.delete_forever),
                              label: const Text('Delete Image'),
                            ),
                            ElevatedButton.icon(
                              onPressed: () {}, // To be wired
                              icon: const Icon(Icons.update),
                              label: const Text('Update'),
                            ),
                            ElevatedButton.icon(
                              onPressed: () {}, // To be wired
                              icon: const Icon(Icons.group_add),
                              label: const Text('Add User to Act'),
                            ),
                          ],
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
