import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/town.dart';

class Debouncer {
  Debouncer({this.ms = 300});
  final int ms;
  Timer? _t;
  Future<T> run<T>(Future<T> Function() fn) {
    _t?.cancel();
    final c = Completer<T>();
    _t = Timer(Duration(milliseconds: ms), () async {
      try {
        c.complete(await fn());
      } catch (e, st) {
        c.completeError(e, st);
      }
    });
    return c.future;
  }

  void dispose() => _t?.cancel();
}

class ActApi {
  // Point this at your orchestrator (adjust host/port as needed)
  final String baseUrl;
  final http.Client _client;
  final Debouncer _debounce = Debouncer(ms: 300);

  ActApi({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        baseUrl = baseUrl ??
            const String.fromEnvironment('EFF_API_BASE',
                defaultValue: 'http://localhost:4000');

  Future<List<Town>> getHometowns(String q,
      {String? state, int limit = 10}) async {
    if (q.trim().length < 3) return [];
    final uri = Uri.parse('$baseUrl/acts/hometowns').replace(queryParameters: {
      'q': q.trim(),
      if (state != null && state.isNotEmpty) 'state': state,
      'limit': '$limit',
    });

    // Debounce to avoid spamming the API on each keystroke
    return _debounce.run(() async {
      final res = await _client.get(uri);
      if (res.statusCode != 200) {
        throw Exception('hometowns failed: ${res.statusCode} ${res.body}');
      }
      final list = jsonDecode(res.body) as List;
      return list.map((e) => Town.fromJson(e as Map<String, dynamic>)).toList();
    });
  }

  Future<List<Town>> getHometownsNear({
    required double lat,
    required double lng,
    int? radiusMi,
    int limit = 50,
  }) async {
    final qp = <String, String>{
      'lat': '$lat',
      'lng': '$lng',
      'limit': '$limit',
      if (radiusMi != null) 'radiusMi': '$radiusMi',
    };
    final uri =
        Uri.parse('$baseUrl/acts/hometowns/near').replace(queryParameters: qp);

    final res = await _client.get(uri);
    if (res.statusCode != 200) {
      throw Exception('near failed: ${res.statusCode} ${res.body}');
    }
    final list = jsonDecode(res.body) as List;
    return list.map((e) => Town.fromJson(e as Map<String, dynamic>)).toList();
  }

  void dispose() {
    _client.close();
    _debounce.dispose();
  }
}
