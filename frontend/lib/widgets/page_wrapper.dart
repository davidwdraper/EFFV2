// lib/widgets/page_wrapper.dart
import 'package:flutter/material.dart';

class PageWrapper extends StatelessWidget {
  final Widget child;

  /// New: control padding inside the 600px container.
  final EdgeInsetsGeometry padding;

  const PageWrapper({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
  });

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 600),
        child: Padding(
          padding: padding,
          child: child,
        ),
      ),
    );
  }
}
