// lib/pages/create_account_page.dart
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../widgets/scaffold_wrapper.dart';
import '../widgets/rounded_card.dart';

class CreateAccountPage extends StatefulWidget {
  const CreateAccountPage({super.key});

  @override
  State<CreateAccountPage> createState() => _CreateAccountPageState();
}

class _CreateAccountPageState extends State<CreateAccountPage> {
  final _formKey = GlobalKey<FormState>();

  final _firstnameController = TextEditingController();
  final _middlenameController = TextEditingController();
  final _lastnameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();

  @override
  void dispose() {
    _firstnameController.dispose();
    _middlenameController.dispose();
    _lastnameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  void _handleCancel() => Navigator.of(context).pop();

  Future<void> _handleCreate() async {
    if (!_formKey.currentState!.validate()) return;

    final body = {
      "firstname": _firstnameController.text.trim(),
      "middlename": _middlenameController.text.trim(),
      "lastname": _lastnameController.text.trim(),
      "eMailAddr": _emailController.text.trim(),
      "password": _passwordController.text,
    };

    try {
      await context.read<AuthProvider>().signupWithCredentials(body);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Account created!')),
      );
      await context.read<AuthProvider>().checkToken();
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: ${e.toString()}')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return ScaffoldWrapper(
      title: null,
      // 🔧 Tighten space outside the card to near-zero
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
      child: Form(
        key: _formKey,
        child: ListView(
          padding: EdgeInsets.zero, // ❌ remove ListView's default padding
          children: [
            RoundedCard(
              // You can go even tighter per-card: padding: EdgeInsets.zero,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Create Account',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  TextFormField(
                    controller: _firstnameController,
                    decoration: const InputDecoration(labelText: 'First Name'),
                    validator: (v) => v!.isEmpty ? 'Required' : null,
                  ),
                  const SizedBox(height: 6),
                  TextFormField(
                    controller: _middlenameController,
                    decoration: const InputDecoration(labelText: 'Middle Name'),
                  ),
                  const SizedBox(height: 6),
                  TextFormField(
                    controller: _lastnameController,
                    decoration: const InputDecoration(labelText: 'Last Name'),
                    validator: (v) => v!.isEmpty ? 'Required' : null,
                  ),
                  const SizedBox(height: 6),
                  TextFormField(
                    controller: _emailController,
                    decoration:
                        const InputDecoration(labelText: 'Email Address'),
                    keyboardType: TextInputType.emailAddress,
                    validator: (v) => v!.isEmpty || !v.contains('@')
                        ? 'Enter valid email'
                        : null,
                  ),
                  const SizedBox(height: 6),
                  TextFormField(
                    controller: _passwordController,
                    decoration: const InputDecoration(labelText: 'Password'),
                    obscureText: true,
                    validator: (v) => v != null && v.length < 6
                        ? 'Minimum 6 characters'
                        : null,
                  ),
                  const SizedBox(height: 12),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      OutlinedButton(
                          onPressed: _handleCancel,
                          child: const Text("Cancel")),
                      ElevatedButton(
                          onPressed: _handleCreate,
                          child: const Text("Create")),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
