// lib/widgets/bottom_pinned_button_bar.dart
import 'package:flutter/material.dart';
import 'page_buttons_row.dart';

/// Wrap your page in this to pin a semi-transparent button bar to the bottom
/// while the content scrolls behind it.
class BottomPinnedButtonBar extends StatelessWidget {
  final Widget content; // your scrolling/images/etc
  final Widget primaryAction; // dominant button on the far right
  final List<Widget> secondaryActions; // left of primary
  final double overlayOpacity; // 0..1, transparency of the bar
  final EdgeInsetsGeometry padding; // inside the bar

  const BottomPinnedButtonBar({
    super.key,
    required this.content,
    required this.primaryAction,
    this.secondaryActions = const [],
    this.overlayOpacity = 0.40, // nice subtle glass
    this.padding = const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
  });

  @override
  Widget build(BuildContext context) {
    final bar = SafeArea(
      top: false,
      left: false,
      right: false,
      child: Container(
        padding: padding,
        decoration: BoxDecoration(
          // withOpacity is deprecated; use withValues(alpha: ...)
          color: Colors.black.withValues(alpha: overlayOpacity),
        ),
        child: PageButtonsRow(
          primaryAction: primaryAction,
          secondaryActions: secondaryActions,
        ),
      ),
    );

    return Stack(
      children: [
        // Your page content scrolls under the bar
        Positioned.fill(child: content),

        // The pinned bar overlays at the physical bottom
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: bar,
        ),
      ],
    );
  }
}
