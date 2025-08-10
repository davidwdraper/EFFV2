// lib/widgets/submit_form.dart
import 'package:flutter/material.dart';

/// Submit bar intended to be pinned at the bottom of a card/screen.
/// Parent should place this inside a Stack and position it at the bottom:
///   Stack(
///     children: [
///       // scrollable content
///       Positioned(
///         left: 0, right: 0, bottom: 0,
///         child: SubmitBar(...),
///       ),
///     ],
///   )
class SubmitBar extends StatelessWidget {
  final String primaryLabel;
  final VoidCallback? onPrimary;
  final VoidCallback? onCancel;
  final bool loading;

  const SubmitBar({
    super.key,
    required this.primaryLabel,
    required this.onPrimary,
    required this.onCancel,
    this.loading = false,
  });

  @override
  Widget build(BuildContext context) {
    final surface = Theme.of(context).colorScheme.surface;
    return Material(
      // Semi-transparent surface with shadow so content can be seen through
      color: surface.withOpacity(0.88),
      elevation: 0,
      child: SafeArea(
        top: false,
        minimum: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Container(
          decoration: BoxDecoration(
            color: Colors.transparent,
            boxShadow: const [
              BoxShadow(
                blurRadius: 8,
                offset: Offset(0, -2),
                color: Color(0x1A000000), // subtle top shadow
              ),
            ],
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.end, // primary on the right
            children: [
              TextButton(
                onPressed: loading ? null : onCancel,
                child: const Text('Cancel'),
              ),
              const SizedBox(width: 12),
              ElevatedButton(
                onPressed: loading ? null : onPrimary,
                child: loading
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(primaryLabel),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
