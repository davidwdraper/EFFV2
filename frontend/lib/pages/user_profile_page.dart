import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../widgets/logo_menu_bar.dart';
import '../widgets/page_wrapper.dart';
import '../widgets/rounded_card.dart';

class UserProfilePage extends StatelessWidget {
  const UserProfilePage({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();

    if (!auth.isAuthenticated) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        Navigator.of(context).pushNamedAndRemoveUntil('/', (_) => false);
      });
    }

    final user = auth.user;
    final userName = auth.userDisplayName ?? 'User';

    final emailController =
        TextEditingController(text: user?['eMailAddr'] ?? '');
    final firstController =
        TextEditingController(text: user?['firstname'] ?? '');
    final middleController =
        TextEditingController(text: user?['middlename'] ?? '');
    final lastController = TextEditingController(text: user?['lastname'] ?? '');

    return PageWrapper(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 600),
          child: RoundedCard(
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
                const SizedBox(height: 24),
                _buildEditableField(context, 'Email', emailController),
                _buildEditableField(context, 'First Name', firstController),
                _buildEditableField(context, 'Middle Name', middleController),
                _buildEditableField(context, 'Last Name', lastController),
                const SizedBox(height: 24),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    TextButton.icon(
                      onPressed: () {},
                      icon: const Icon(Icons.add_photo_alternate),
                      label: const Text('Add Image'),
                    ),
                    TextButton.icon(
                      onPressed: () {},
                      icon: const Icon(Icons.delete_forever),
                      label: const Text('Delete Image'),
                    ),
                    ElevatedButton.icon(
                      onPressed: () {
                        // TODO: Add update logic here
                      },
                      icon: const Icon(Icons.update),
                      label: const Text('Update'),
                    ),
                    TextButton.icon(
                      onPressed: () {},
                      icon: const Icon(Icons.group_add),
                      label: const Text('Add User to Act'),
                    ),
                    TextButton.icon(
                      onPressed: () {
                        Navigator.of(context).pop();
                      },
                      icon: const Icon(Icons.close),
                      label: const Text('Close'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildEditableField(
    BuildContext context,
    String label,
    TextEditingController controller,
  ) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8.0),
      child: TextFormField(
        controller: controller,
        decoration: InputDecoration(
          labelText: label,
          labelStyle: const TextStyle(fontWeight: FontWeight.w500),
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
          filled: true,
          fillColor: Colors.grey[50],
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: const BorderSide(color: Colors.grey),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: const BorderSide(color: Colors.grey),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide:
                BorderSide(color: Theme.of(context).primaryColor, width: 2),
          ),
        ),
      ),
    );
  }
}
