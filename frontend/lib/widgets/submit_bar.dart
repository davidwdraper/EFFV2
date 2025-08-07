import 'package:flutter/material.dart';

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
    return Row(
      children: [
        ElevatedButton(
          onPressed: loading ? null : onPrimary,
          child: loading
              ? const SizedBox(
                  height: 18,
                  width: 18,
                  child: CircularProgressIndicator(strokeWidth: 2))
              : Text(primaryLabel),
        ),
        const SizedBox(width: 12),
        TextButton(
          onPressed: loading ? null : onCancel,
          child: const Text('Cancel'),
        ),
      ],
    );
  }
}
