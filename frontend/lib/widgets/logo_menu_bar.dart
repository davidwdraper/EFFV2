import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../pages/create_account_page.dart';
import '../pages/login_page.dart';
import '../providers/auth_provider.dart';

class LogoMenuBar extends StatelessWidget {
  const LogoMenuBar({super.key});

  void _handleMenuSelection(BuildContext context, String value) async {
    final authProvider = Provider.of<AuthProvider>(context, listen: false);

    switch (value) {
      case 'login':
        await Navigator.of(context)
            .push(MaterialPageRoute(builder: (context) => const LoginPage()));
        await authProvider.checkToken();
        break;
      case 'logout':
        await authProvider.logout();
        break;
      case 'create':
        if (!authProvider.isAuthenticated) {
          await Navigator.of(context)
              .push(MaterialPageRoute(builder: (context) => const CreateAccountPage()));
          await authProvider.checkToken();
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
    final authProvider = Provider.of<AuthProvider>(context);
    final isAuthenticated = authProvider.isAuthenticated;
    final userDisplayName = authProvider.userDisplayName;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Image.asset(
          'assets/logo.png',
          height: 64,
          fit: BoxFit.contain,
        ),
        const Spacer(),
        if (isAuthenticated && userDisplayName != null)
          Padding(
            padding: const EdgeInsets.only(top: 12.0, right: 8.0),
            child: Text(
              userDisplayName,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
        PopupMenuButton<String>(
          icon: const Icon(Icons.menu, size: 32),
          onSelected: (value) => _handleMenuSelection(context, value),
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
