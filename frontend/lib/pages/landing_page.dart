import 'package:flutter/material.dart';
import '../widgets/logo_menu_bar.dart';

class LandingPage extends StatelessWidget {
  const LandingPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey[100],
      body: SafeArea(
        child: Center(
          child: Container(
            color: Colors.white, // Left and right white borders
            constraints: const BoxConstraints(maxWidth: 600),
            padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0), // Inner padding
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                LogoMenuBar(),
                // Add additional landing content here
              ],
            ),
          ),
        ),
      ),
    );
  }
}
