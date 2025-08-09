// lib/widgets/ownership_info.dart
import 'package:flutter/material.dart';

class OwnershipInfo extends StatelessWidget {
  final String? creatorName;
  final String? ownerName;
  final bool showClaimButton;
  final VoidCallback? onClaim;

  /// Width reserved for the "Claim" button to keep text perfectly aligned
  static const double _claimSlotWidth = 56; // tuned for "Claim" text

  const OwnershipInfo({
    super.key,
    required this.creatorName,
    required this.ownerName,
    this.showClaimButton = false,
    this.onClaim,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final labelStyle = theme.textTheme.labelSmall?.copyWith(
      color: theme.colorScheme.onSurface.withOpacity(0.7),
      fontWeight: FontWeight.w500,
    );

    final valueStyle = theme.textTheme.bodySmall?.copyWith(
      fontWeight: FontWeight.w600,
    );

    // Real claim button
    final claimBtn = TextButton(
      onPressed: onClaim,
      style: TextButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        minimumSize: const Size(0, 0),
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        visualDensity: VisualDensity.compact,
      ),
      child: const Text('Claim'),
    );

    // Placeholder to keep alignment when no claim button
    const claimSpacer = SizedBox(width: _claimSlotWidth);

    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 260),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Creator
          Text('Creator Name', style: labelStyle, textAlign: TextAlign.right),
          // row reserves the same slot width as claim to align with owner row
          Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              claimSpacer,
              Flexible(
                child: Text(
                  (creatorName?.trim().isNotEmpty == true) ? creatorName! : '—',
                  style: valueStyle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.right,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),

          // Owner
          Text('Owner Name', style: labelStyle, textAlign: TextAlign.right),
          Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              // Button slot on the LEFT of the owner's name
              SizedBox(
                width: _claimSlotWidth,
                child: showClaimButton ? claimBtn : const SizedBox.shrink(),
              ),
              Flexible(
                child: Text(
                  (ownerName?.trim().isNotEmpty == true) ? ownerName! : '—',
                  style: valueStyle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.right,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
