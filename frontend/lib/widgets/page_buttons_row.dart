// lib/widgets/page_buttons_row.dart
import 'package:flutter/material.dart';

/// A reusable row of page-level action buttons.
///
/// Layout rules:
/// - All buttons are aligned to the right.
/// - The dominant action (primary) is placed at the far right.
/// - Pass [primaryAction] for the main button, and [secondaryActions] for all others.
class PageButtonsRow extends StatelessWidget {
  final Widget primaryAction;
  final List<Widget> secondaryActions;
  final double spacing;

  const PageButtonsRow({
    super.key,
    required this.primaryAction,
    this.secondaryActions = const [],
    this.spacing = 12,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.end, // Right-justify
      children: [
        ...secondaryActions.map((btn) => Padding(
              padding: EdgeInsets.only(right: spacing),
              child: btn,
            )),
        primaryAction, // dominant action is always last (far right)
      ],
    );
  }
}
