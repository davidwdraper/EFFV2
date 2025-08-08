// lib/pages/user_profile_page.dart
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../widgets/scaffold_wrapper.dart';
import '../widgets/rounded_card.dart';

class UserProfilePage extends StatefulWidget {
  const UserProfilePage({super.key});

  @override
  State<UserProfilePage> createState() => _UserProfilePageState();
}

class _UserProfilePageState extends State<UserProfilePage> {
  final _formKey = GlobalKey<FormState>();

  final _emailController = TextEditingController();
  final _firstController = TextEditingController();
  final _middleController = TextEditingController();
  final _lastController = TextEditingController();

  bool _isSubmitting = false;
  bool _inited = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_inited) return;

    final auth = context.read<AuthProvider>();
    // Redirect to home if not authed (after first frame to avoid build-time nav)
    if (!auth.isAuthenticated) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          Navigator.of(context).pushNamedAndRemoveUntil('/', (_) => false);
        }
      });
      return;
    }

    final user = auth.user;
    _emailController.text = (user?['eMailAddr'] ?? '') as String;
    _firstController.text = (user?['firstname'] ?? '') as String;
    _middleController.text = (user?['middlename'] ?? '') as String;
    _lastController.text = (user?['lastname'] ?? '') as String;

    _inited = true;
  }

  @override
  void dispose() {
    _emailController.dispose();
    _firstController.dispose();
    _middleController.dispose();
    _lastController.dispose();
    super.dispose();
  }

  Future<void> _handleUpdate() async {
    if (_isSubmitting) return;

    // If you add validators later:
    // if (!_formKey.currentState!.validate()) return;

    setState(() => _isSubmitting = true);

    try {
      // TODO: wire to your update endpoint via AuthProvider or a users provider
      await Future<void>.delayed(const Duration(milliseconds: 300));

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Profile updated')),
      );

      // Optionally refresh auth/user display
      await context.read<AuthProvider>().checkToken();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Update failed: $e')),
      );
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final userName = auth.userDisplayName ?? 'User';

    return ScaffoldWrapper(
      title:
          null, // header comes from ScaffoldWrapper's logo bar; keep title inside card if you add one
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
      child: Form(
        key: _formKey,
        child: Shortcuts(
          // Non-const map to avoid const-constructor issues across SDKs
          shortcuts: <LogicalKeySet, Intent>{
            LogicalKeySet(LogicalKeyboardKey.enter): const ActivateIntent(),
            LogicalKeySet(LogicalKeyboardKey.numpadEnter):
                const ActivateIntent(),
          },
          child: Actions(
            actions: {
              ActivateIntent: CallbackAction<ActivateIntent>(
                onInvoke: (_) {
                  _handleUpdate();
                  return null;
                },
              ),
            },
            child: ListView(
              padding: EdgeInsets.zero,
              children: [
                RoundedCard(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Header row with avatar + display name
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          const CircleAvatar(
                            radius: 40,
                            backgroundImage:
                                AssetImage('assets/default_avatar.png'),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              userName,
                              style: Theme.of(context)
                                  .textTheme
                                  .titleLarge
                                  ?.copyWith(
                                    fontWeight: FontWeight.w600,
                                  ),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),

                      _buildEditableField(context, 'Email', _emailController,
                          keyboardType: TextInputType.emailAddress),
                      _buildEditableField(
                          context, 'First Name', _firstController),
                      _buildEditableField(
                          context, 'Middle Name', _middleController),
                      _buildEditableField(
                          context, 'Last Name', _lastController),

                      const SizedBox(height: 12),

                      Wrap(
                        spacing: 12,
                        runSpacing: 12,
                        children: [
                          TextButton.icon(
                            onPressed: () {
                              // TODO: add image workflow
                            },
                            icon: const Icon(Icons.add_photo_alternate),
                            label: const Text('Add Image'),
                          ),
                          TextButton.icon(
                            onPressed: () {
                              // TODO: delete image workflow
                            },
                            icon: const Icon(Icons.delete_forever),
                            label: const Text('Delete Image'),
                          ),
                          ElevatedButton.icon(
                            onPressed: _isSubmitting ? null : _handleUpdate,
                            icon: _isSubmitting
                                ? const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2),
                                  )
                                : const Icon(Icons.update),
                            label: const Text('Update'),
                          ),
                          TextButton.icon(
                            onPressed: () {
                              // TODO: add user to act flow
                            },
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
    TextEditingController controller, {
    TextInputType? keyboardType,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6.0),
      child: TextFormField(
        controller: controller,
        keyboardType: keyboardType,
        decoration: InputDecoration(
          labelText: label,
          labelStyle: const TextStyle(fontWeight: FontWeight.w500),
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
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
        textInputAction: TextInputAction.next,
        // If this is the last field, you could set done + submit; for now Update is bound to Enter globally
      ),
    );
  }
}
