// lib/widgets/ownership_info.dart
import 'package:flutter/material.dart';

class OwnershipInfo extends StatelessWidget {
  final String? creatorName;
  final String? ownerName;
  final String? createdById;
  final String? ownerId;
  final String? jwtUserId;
  final VoidCallback? onClaim;

  /// Width reserved for the "Claim" button to keep text perfectly aligned
  static const double _claimSlotWidth = 56; // tuned for "Claim" text

  const OwnershipInfo({
    super.key,
    required this.creatorName,
    required this.ownerName,
    this.createdById,
    this.ownerId,
    this.jwtUserId,
    this.onClaim,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final valueStyle = theme.textTheme.bodySmall?.copyWith(
      fontWeight: FontWeight.w600,
    );

    // Claim button logic:
    final bool showClaim = (createdById != null &&
        ownerId != null &&
        jwtUserId != null &&
        createdById == ownerId &&
        jwtUserId != ownerId);

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

    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 260),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        mainAxisSize: MainAxisSize.min,
        children: [
          // ---------- Creator Row ----------
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(width: _claimSlotWidth), // align with owner row
              Flexible(
                child: Text(
                  'Creator: ${_display(creatorName)}',
                  style: valueStyle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.right,
                ),
              ),
            ],
          ),

          const SizedBox(height: 4),

          // ---------- Owner Row ----------
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Button slot on the LEFT of the owner's name
              SizedBox(
                width: _claimSlotWidth,
                child: (showClaim && onClaim != null)
                    ? claimBtn
                    : const SizedBox.shrink(),
              ),
              Flexible(
                child: Text(
                  'Owner: ${_display(ownerName)}',
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

  String _display(String? v) {
    final s = v?.trim() ?? '';
    return s.isEmpty ? '—' : s;
  }
}
