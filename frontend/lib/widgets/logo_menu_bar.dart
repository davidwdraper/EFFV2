import 'package:flutter/material.dart';
import '../pages/create_account_page.dart';
import '../utils/auth_storage.dart';

class LogoMenuBar extends StatefulWidget {
  const LogoMenuBar({super.key});

  @override
  State<LogoMenuBar> createState() => _LogoMenuBarState();
}

class _LogoMenuBarState extends State<LogoMenuBar> {
  bool isAuthenticated = false;

  @override
  void initState() {
    super.initState();
    _checkToken();
  }

  Future<void> _checkToken() async {
    final token = await AuthStorage.getToken();
    setState(() {
      isAuthenticated = token != null;
    });
  }

  void _handleMenuSelection(String value) async {
    switch (value) {
      case 'login':
        debugPrint("Login tapped");
        break;
      case 'logout':
        await AuthStorage.clearToken();
        setState(() {
          isAuthenticated = false;
        });
        break;
      case 'create':
        if (!isAuthenticated) {
          Navigator.of(context).push(
            MaterialPageRoute(builder: (context) => const CreateAccountPage()),
          );
        }
        break;
      case 'acts':
        debugPrint("Acts tapped");
        break;
      case 'profile':
        debugPrint("Profile tapped");
        break;
      default:
        debugPrint('Selected: $value');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Image.asset(
          'assets/logo.png',
          height: 64,
          fit: BoxFit.contain,
        ),
        const Spacer(),
        PopupMenuButton<String>(
          icon: const Icon(Icons.menu, size: 32),
          onSelected: _handleMenuSelection,
          itemBuilder: (BuildContext context) => [
            PopupMenuItem(
              value: isAuthenticated ? 'logout' : 'login',
              child: Text(isAuthenticated ? 'Logout' : 'Login'),
            ),
            PopupMenuItem(
              value: 'create',
              enabled: !isAuthenticated,
              child: Text(
                'Create Account',
                style: TextStyle(
                  color: isAuthenticated ? Colors.grey : null,
                ),
              ),
            ),
            const PopupMenuItem(value: 'acts', child: Text('Acts')),
            PopupMenuItem(
              value: 'profile',
              enabled: isAuthenticated,
              child: Text(
                'Profile',
                style: TextStyle(
                  color: isAuthenticated ? null : Colors.grey,
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
