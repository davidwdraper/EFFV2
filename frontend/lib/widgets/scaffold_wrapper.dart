import 'package:flutter/material.dart';
import 'logo_menu_bar.dart';

class ScaffoldWrapper extends StatelessWidget {
  final String? title; // 👈 new
  final Widget child;

  const ScaffoldWrapper({super.key, this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey[100],
      body: SafeArea(
        child: Center(
          child: Container(
            color: Colors.white, // white background on content
            constraints: const BoxConstraints(maxWidth: 600),
            padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0), // inner padding
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const LogoMenuBar(),
                if (title != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    title!,
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const Divider(),
                ],
                const SizedBox(height: 16),
                Expanded(child: child),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
