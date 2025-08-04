import 'package:flutter/material.dart';
import '../pages/create_account_page.dart';

class LogoMenuBar extends StatelessWidget {
  const LogoMenuBar({super.key});

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
          onSelected: (value) {
            switch (value) {
              case 'create':
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (context) => const CreateAccountPage(),
                  ),
                );
                break;
              default:
                debugPrint('Selected: $value');
            }
          },
          itemBuilder: (BuildContext context) => const [
            PopupMenuItem(value: 'login', child: Text('Login')),
            PopupMenuItem(value: 'create', child: Text('Create Account')),
            PopupMenuItem(value: 'acts', child: Text('Acts')),
            PopupMenuItem(value: 'profile', child: Text('Profile')),
          ],
        ),
      ],
    );
  }
}
