// lib/widgets/scaffold_wrapper.dart
import 'package:flutter/material.dart';
import 'logo_menu_bar.dart';
import 'page_wrapper.dart';

class ScaffoldWrapper extends StatelessWidget {
  final String? title;
  final Widget child;

  /// New: control the padding *around* your page content (outside the card).
  /// Default is tight.
  final EdgeInsetsGeometry contentPadding;

  const ScaffoldWrapper({
    super.key,
    required this.child,
    this.title,
    this.contentPadding =
        const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
  });

  @override
  Widget build(BuildContext context) {
    final hasTitle = title != null && title!.trim().isNotEmpty;

    return Scaffold(
      backgroundColor: Colors.grey[100],
      body: SafeArea(
        child: Column(
          children: [
            const LogoMenuBar(),
            Expanded(
              child: PageWrapper(
                padding: contentPadding, // << use tight padding
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (hasTitle) ...[
                      Text(
                        title!,
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 8),
                    ],
                    Expanded(child: child),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
