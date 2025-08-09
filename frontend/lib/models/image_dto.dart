class ImageDto {
  final String id;
  final String url;
  final String? comment;
  final String? createdByName;
  final DateTime createdAt;

  ImageDto({
    required this.id,
    required this.url,
    required this.comment,
    required this.createdByName,
    required this.createdAt,
  });

  factory ImageDto.fromJson(Map<String, dynamic> json) => ImageDto(
        id: json['id'] as String,
        url: json['url'] as String,
        comment: json['comment'] as String?,
        createdByName: json['createdByName'] as String?,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}
