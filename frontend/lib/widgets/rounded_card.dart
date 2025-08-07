import 'package:flutter/material.dart';

class RoundedCard extends StatelessWidget {
  final Widget child;

  const RoundedCard({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 4,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: child,
      ),
    );
  }
}
