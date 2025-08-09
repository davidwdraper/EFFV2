import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/paged_images.dart';

class ImageApi {
  // TODO: point this to your orchestrator base, e.g., http://localhost:4000
  static String apiBase = const String.fromEnvironment('API_BASE',
      defaultValue: 'http://localhost:4000');

  static Future<PagedImages> getActImages({
    required String actId,
    required int skip,
    int limit = 12,
    String? jwt,
  }) async {
    final uri =
        Uri.parse('$apiBase/acts/$actId/images?skip=$skip&limit=$limit');
    final headers = <String, String>{
      'Content-Type': 'application/json',
      if (jwt != null && jwt.isNotEmpty) 'Authorization': 'Bearer $jwt',
    };

    final resp = await http.get(uri, headers: headers);
    if (resp.statusCode < 200 || resp.statusCode >= 300) {
      throw Exception('Failed to fetch images (${resp.statusCode})');
    }
    final jsonMap = json.decode(resp.body) as Map<String, dynamic>;
    return PagedImages.fromJson(jsonMap);
  }
}
