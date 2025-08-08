import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../widgets/scaffold_wrapper.dart';
import '../widgets/rounded_card.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _isSubmitting = false;
  String? _errorMessage;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _handleLogin() async {
    if (!_formKey.currentState!.validate()) return;

    // Close the autofill context so iOS/Android password managers don’t bleed into next pages
    TextInput.finishAutofillContext(shouldSave: true);

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    try {
      await context.read<AuthProvider>().loginWithCredentials(
            _emailController.text.trim(),
            _passwordController.text,
          );

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Login successful')),
      );
      Navigator.of(context).pop();
    } catch (e) {
      setState(() => _errorMessage = "Login failed: ${e.toString()}");
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  void _handleForgotPassword() {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Forgot Password not implemented yet')),
    );
  }

  void _handleCancel() => Navigator.of(context).pop();

  InputDecoration _decor(BuildContext context, String label) {
    return InputDecoration(
      labelText: label,
      labelStyle: const TextStyle(fontWeight: FontWeight.w500),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
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
        borderSide: BorderSide(color: Theme.of(context).primaryColor, width: 2),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ScaffoldWrapper(
      title: null, // keep only in-card title
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
      child: Form(
        key: _formKey,
        child: Shortcuts(
          // NOTE: non-const map to avoid const-constructor errors
          shortcuts: <LogicalKeySet, Intent>{
            LogicalKeySet(LogicalKeyboardKey.enter): const ActivateIntent(),
            LogicalKeySet(LogicalKeyboardKey.numpadEnter):
                const ActivateIntent(),
          },
          child: Actions(
            actions: {
              ActivateIntent: CallbackAction<ActivateIntent>(
                onInvoke: (intent) {
                  if (!_isSubmitting) _handleLogin();
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
                  child: AutofillGroup(
                    // ✅ scope autofill to this card
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          "Login",
                          style: TextStyle(
                              fontSize: 20, fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 8),

                        if (_errorMessage != null) ...[
                          Text(_errorMessage!,
                              style: const TextStyle(color: Colors.red)),
                          const SizedBox(height: 8),
                        ],

                        // Email
                        TextFormField(
                          controller: _emailController,
                          decoration: _decor(context, 'Email Address'),
                          keyboardType: TextInputType.emailAddress,
                          validator: (value) =>
                              value == null || !value.contains('@')
                                  ? 'Enter valid email'
                                  : null,
                          textInputAction: TextInputAction.next,
                          autofillHints: const [
                            AutofillHints.username,
                            AutofillHints.email,
                          ], // ✅ tell managers what this is
                        ),
                        const SizedBox(height: 6),

                        // Password
                        TextFormField(
                          controller: _passwordController,
                          decoration: _decor(context, 'Password'),
                          obscureText: true,
                          enableSuggestions:
                              false, // ✅ no suggestions for passwords
                          autocorrect: false, // ✅ no autocorrect for passwords
                          validator: (value) =>
                              value == null || value.length < 6
                                  ? 'Minimum 6 characters'
                                  : null,
                          textInputAction: TextInputAction.done,
                          onFieldSubmitted: (_) => _handleLogin(),
                          autofillHints: const [
                            AutofillHints.password,
                          ], // ✅ mark as password
                        ),
                        const SizedBox(height: 8),

                        Align(
                          alignment: Alignment.centerRight,
                          child: TextButton(
                            onPressed: _handleForgotPassword,
                            child: const Text("Forgot Password?"),
                          ),
                        ),
                        const SizedBox(height: 10),

                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                          children: [
                            OutlinedButton(
                              onPressed: _isSubmitting ? null : _handleCancel,
                              child: const Text("Cancel"),
                            ),
                            ElevatedButton(
                              onPressed: _isSubmitting ? null : _handleLogin,
                              child: _isSubmitting
                                  ? const SizedBox(
                                      width: 16,
                                      height: 16,
                                      child: CircularProgressIndicator(
                                          strokeWidth: 2),
                                    )
                                  : const Text("Login"),
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
