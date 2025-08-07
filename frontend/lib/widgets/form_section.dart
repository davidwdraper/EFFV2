import 'package:flutter/material.dart';

class FormSection extends StatelessWidget {
  final String? label;
  final Widget child;
  final EdgeInsetsGeometry padding;

  const FormSection({
    super.key,
    this.label,
    required this.child,
    this.padding = const EdgeInsets.only(bottom: 12),
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (label != null) ...[
            Text(label!, style: const TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
          ],
          child,
        ],
      ),
    );
  }
}
