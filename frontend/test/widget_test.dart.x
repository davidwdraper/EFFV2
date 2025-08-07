import 'package:flutter/material.dart';
import '../widgets/page_wrapper.dart';
import '../widgets/rounded_card.dart';

class ActsPage extends StatelessWidget {
  const ActsPage({super.key});

  @override
  Widget build(BuildContext context) {
    return PageWrapper(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 600),
          child: Padding(
            padding: const EdgeInsets.all(12.0),
            child: RoundedCard(
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: const [
                    Text(
                      'Acts',
                      style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    SizedBox(height: 16),
                    Text(
                      'This is a placeholder for the Acts screen.',
                      textAlign: TextAlign.left,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
