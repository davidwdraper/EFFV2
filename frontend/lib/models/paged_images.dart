import 'image_dto.dart';

class PagedImages {
  final List<ImageDto> items;
  final int total;
  final int skip;
  final int limit;
  final bool hasMore;

  PagedImages({
    required this.items,
    required this.total,
    required this.skip,
    required this.limit,
    required this.hasMore,
  });

  factory PagedImages.fromJson(Map<String, dynamic> json) => PagedImages(
        items: (json['items'] as List<dynamic>? ?? [])
            .map((e) => ImageDto.fromJson(e as Map<String, dynamic>))
            .toList(),
        total: json['total'] as int? ?? 0,
        skip: json['skip'] as int? ?? 0,
        limit: json['limit'] as int? ?? 0,
        hasMore: json['hasMore'] as bool? ?? false,
      );
}
