import 'package:flutter/material.dart';
import '../widgets/page_wrapper.dart';
import '../widgets/rounded_card.dart';

class FormPageScaffold extends StatelessWidget {
  final String title;
  final Widget child;
  final double maxWidth;

  const FormPageScaffold({
    super.key,
    required this.title,
    required this.child,
    this.maxWidth = 600,
  });

  @override
  Widget build(BuildContext context) {
    return PageWrapper(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: RoundedCard(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start, // match ActsPage
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                      fontSize: 24, fontWeight: FontWeight.bold),
                  textAlign: TextAlign.left,
                ),
                const SizedBox(height: 24),
                child,
              ],
            ),
          ),
        ),
      ),
    );
  }
}
