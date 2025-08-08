import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../pages/create_account_page.dart';
import '../pages/login_page.dart';
import '../pages/user_profile_page.dart';
import '../providers/auth_provider.dart';

class LogoMenuBar extends StatelessWidget {
  const LogoMenuBar({super.key});

  void _onMenuSelect(BuildContext context, String value) async {
    final auth = Provider.of<AuthProvider>(context, listen: false);

    switch (value) {
      case 'login':
        await Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => const LoginPage()),
        );
        await auth.checkToken();
        break;

      case 'logout':
        await auth.logout();
        if (context.mounted) {
          Navigator.pushNamedAndRemoveUntil(context, '/', (_) => false);
        }
        break;

      case 'create':
        if (!auth.isAuthenticated) {
          await Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const CreateAccountPage()),
          );
          await auth.checkToken();
        }
        break;

      case 'acts':
        Navigator.pushNamed(context, '/acts');
        break;

      case 'profile':
        Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => const UserProfilePage()),
        );
        break;

      default:
        debugPrint('Unhandled menu value: $value');
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final userName = auth.isAuthenticated
        ? auth.userDisplayName ?? 'User'
        : 'Hello Anonymous User';

    final theme = Theme.of(context);
    // ✅ Pin the style so inherited text themes (e.g., bright red) don’t leak in.
    final nameStyle = theme.textTheme.labelLarge?.copyWith(
      color: theme.colorScheme.onSurface,
      fontWeight: FontWeight.w600,
    );

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 600),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Image.asset('assets/logo.png', height: 64, fit: BoxFit.contain),
            Row(
              children: [
                // Keep the username tidy and unbreakable
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 220),
                    child: Text(
                      userName,
                      style: nameStyle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      softWrap: false,
                    ),
                  ),
                ),
                MenuOptions(
                  isAuthenticated: auth.isAuthenticated,
                  onSelected: (value) => _onMenuSelect(context, value),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class MenuOptions extends StatelessWidget {
  final bool isAuthenticated;
  final void Function(String) onSelected;

  const MenuOptions({
    super.key,
    required this.isAuthenticated,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      icon: const Icon(Icons.menu, size: 32),
      onSelected: onSelected,
      itemBuilder: (_) => [
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
    );
  }
}
