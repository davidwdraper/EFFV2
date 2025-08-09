import 'package:flutter/material.dart';
import '../models/image_dto.dart';
import '../services/image_api.dart';
import 'act_image_item.dart';

class ActImagesLazy extends StatefulWidget {
  final String actId;
  final String? jwt;
  final int pageSize;

  /// Notifies parent whenever selection changes (IDs of selected images)
  final ValueChanged<Set<String>>? onSelectionChanged;

  const ActImagesLazy({
    super.key,
    required this.actId,
    this.jwt,
    this.pageSize = 12,
    this.onSelectionChanged,
  });

  @override
  State<ActImagesLazy> createState() => _ActImagesLazyState();
}

class _ActImagesLazyState extends State<ActImagesLazy> {
  final List<ImageDto> _items = [];
  final Set<String> _selected = <String>{};

  int _skip = 0;
  bool _loading = false;
  bool _hasMore = true;
  int _total = 0;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadNextPage();
  }

  Future<void> _loadNextPage() async {
    if (_loading || !_hasMore) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await ImageApi.getActImages(
        actId: widget.actId,
        skip: _skip,
        limit: widget.pageSize,
        jwt: widget.jwt,
      );
      setState(() {
        _items.addAll(page.items);
        _skip += page.items.length;
        _hasMore = page.hasMore;
        _total = page.total;
      });
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _toggleSelection(String id, bool? value) {
    setState(() {
      if (value == true) {
        _selected.add(id);
      } else {
        _selected.remove(id);
      }
    });
    widget.onSelectionChanged?.call(_selected);
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(12),
        child: Text('Could not load images: $_error'),
      );
    }

    if (_items.isEmpty && _loading) {
      return const Padding(
        padding: EdgeInsets.all(12),
        child: Center(child: CircularProgressIndicator()),
      );
    }

    if (_items.isEmpty) {
      return const Padding(
        padding: EdgeInsets.all(12),
        child: Text('No images yet.'),
      );
    }

    final primary = _items.first;
    final tail = _items.length > 1 ? _items.sublist(1) : <ImageDto>[];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Images ($_total)',
            style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 12),

        // Primary
        ActImageItem(
          img: primary,
          selected: _selected.contains(primary.id),
          onChanged: (v) => _toggleSelection(primary.id, v),
        ),
        const SizedBox(height: 12),

        // Tail list
        for (final img in tail) ...[
          ActImageItem(
            img: img,
            selected: _selected.contains(img.id),
            onChanged: (v) => _toggleSelection(img.id, v),
          ),
          const SizedBox(height: 12),
        ],

        // Load more
        if (_hasMore) ...[
          const SizedBox(height: 8),
          Center(
            child: FilledButton(
              onPressed: _loading ? null : _loadNextPage,
              child: _loading
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Load more'),
            ),
          ),
        ],
      ],
    );
  }
}
