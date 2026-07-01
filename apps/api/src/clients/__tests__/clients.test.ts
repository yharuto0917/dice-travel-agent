import {
  GeoPointSchema,
  ImageResultSchema,
  LodgingSchema,
  PoiSchema,
  RestaurantSchema,
  TransportLegSchema,
  WeatherDailySchema,
} from "@repo/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientBase } from "../base";
import { GeocodingClient } from "../geocoding";
import { ImageClient } from "../image";
import { LodgingClient } from "../lodging";
import { PoiClient } from "../poi";
import { RestaurantClient } from "../restaurant";
import { TransitClient } from "../transit";
import { WeatherClient } from "../weather";

// 簡易的なインメモリKVモック
class MockKVNamespace {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }

  async put(key: string, value: string, _options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(): Promise<unknown> {
    return { keys: Array.from(this.store.keys()).map((k) => ({ name: k })), list_complete: true };
  }
}

describe("ApiClientBase (KV キャッシュテスト)", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = new MockKVNamespace() as unknown as KVNamespace;
  });

  it("キャッシュが存在しない場合はフェッチ関数を呼び出し、結果をキャッシュすること", async () => {
    const client = new ApiClientBase(kv);
    let callCount = 0;
    const fetchFn = async () => {
      callCount++;
      return { val: "hello" };
    };

    // biome-ignore lint/suspicious/noExplicitAny: test needs access to protected method
    const res = await (client as any).withCache("test-key", 60, fetchFn);
    expect(res).toEqual({ val: "hello" });
    expect(callCount).toBe(1);

    // 2回目の呼び出しではキャッシュから取得されるため、fetchFn は呼ばれない
    // biome-ignore lint/suspicious/noExplicitAny: test needs access to protected method
    const res2 = await (client as any).withCache("test-key", 60, fetchFn);
    expect(res2).toEqual({ val: "hello" });
    expect(callCount).toBe(1);
  });
});

describe("GeocodingClient", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("Google APIキーがある場合は Google Geocoding API を呼び出すこと", async () => {
    const mockResponse = {
      status: "OK",
      results: [
        {
          geometry: {
            location: { lat: 35.681238, lng: 139.767125 },
          },
        },
      ],
    };

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      expect(url).toContain("maps.googleapis.com/maps/api/geocode/json");
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    const client = new GeocodingClient({ apiKey: "mock-google-key" });
    const result = await client.geocode("東京駅");

    expect(result).not.toBeNull();
    expect(result?.lat).toBe(35.681238);
    expect(result?.lng).toBe(139.767125);
    expect(GeoPointSchema.safeParse(result).success).toBe(true);
  });

  it("Google APIキーがない場合は国土地理院 API を呼び出すこと", async () => {
    const mockResponse = [
      {
        geometry: {
          coordinates: [139.767125, 35.681238], // [lng, lat]
          type: "Point",
        },
        properties: {
          title: "東京都千代田区丸の内一丁目",
        },
      },
    ];

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      expect(url).toContain("msearch.gsi.go.jp/address-search");
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    const client = new GeocodingClient({});
    const result = await client.geocode("東京駅");

    expect(result).not.toBeNull();
    expect(result?.lat).toBe(35.681238);
    expect(result?.lng).toBe(139.767125);
    expect(GeoPointSchema.safeParse(result).success).toBe(true);
  });
});

describe("PoiClient", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("Google APIキーがある場合は Google Places API (New) を呼び出すこと", async () => {
    const mockResponse = {
      places: [
        {
          id: "google-place-1",
          displayName: { text: "東京タワー" },
          location: { latitude: 35.65858, longitude: 139.74543 },
          formattedAddress: "東京都港区芝公園４丁目２-８",
          rating: 4.5,
          priceLevel: "PRICE_LEVEL_FREE",
          websiteUri: "https://www.tokyotower.co.jp/",
        },
      ],
    };

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      expect(url).toContain("places.googleapis.com/v1/places:searchNearby");
      expect((init?.headers as Record<string, string>)?.["X-Goog-Api-Key"]).toBe("mock-google-key");
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    const client = new PoiClient({ googleApiKey: "mock-google-key" });
    const result = await client.searchNearby(35.65858, 139.74543);

    expect(result.length).toBe(1);
    expect(result[0]?.id).toBe("google-place-1");
    expect(result[0]?.name).toBe("東京タワー");
    expect(result[0]?.priceLevel).toBe(0); // FREE -> 0
    expect(result[0]?.source).toBe("google");
    expect(PoiSchema.safeParse(result[0]).success).toBe(true);
  });

  it("Google APIキーがなく Foursquare キーがある場合は FSQ OS Places API を呼び出すこと", async () => {
    const mockResponse = {
      results: [
        {
          fsq_place_id: "fsq-place-1",
          name: "東京タワー",
          // FSQ OS Places では緯度経度はトップレベルに返る
          latitude: 35.65858,
          longitude: 139.74543,
          location: { formatted_address: "東京都港区芝公園４丁目２-８" },
          rating: 9.0,
          price: 2,
          website: "https://www.tokyotower.co.jp/",
        },
      ],
    };

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      expect(url).toContain("places-api.foursquare.com/places/search");
      const headers = init?.headers as Record<string, string>;
      // 旧 v3 の生キーではなく Bearer 認証 + バージョンヘッダーであることを検証
      expect(headers?.Authorization).toBe("Bearer mock-fsq-key");
      expect(headers?.["X-Places-Api-Version"]).toBe("2025-06-17");
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    const client = new PoiClient({ foursquareKey: "mock-fsq-key" });
    const result = await client.searchNearby(35.65858, 139.74543);

    expect(result.length).toBe(1);
    expect(result[0]?.id).toBe("fsq-place-1");
    expect(result[0]?.point.lat).toBe(35.65858);
    expect(result[0]?.rating).toBe(4.5); // 9.0 / 2 -> 4.5
    expect(result[0]?.priceLevel).toBe(2);
    expect(result[0]?.url).toBe("https://www.tokyotower.co.jp/");
    expect(result[0]?.source).toBe("foursquare");
    expect(PoiSchema.safeParse(result[0]).success).toBe(true);
  });

  it("APIキーが何も設定されていない場合は即座に空配列を返すこと", async () => {
    const client = new PoiClient({});
    const result = await client.searchNearby(35.65858, 139.74543);
    expect(result).toEqual([]);
  });
});

describe("WeatherClient", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("通常は Open-Meteo API を呼び出し、結果をパースすること", async () => {
    const mockResponse = {
      daily: {
        time: ["2026-06-24", "2026-06-25"],
        weather_code: [0, 61], // 晴れ, 雨
        temperature_2m_max: [28.5, 23.0],
        temperature_2m_min: [19.0, 18.0],
        precipitation_probability_max: [10, 80],
      },
    };

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      expect(url).toContain("api.open-meteo.com/v1/forecast");
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    const client = new WeatherClient({});
    const result = await client.getForecast(35.681238, 139.767125);

    expect(result.length).toBe(2);
    expect(result[0]?.condition).toBe("晴れ");
    expect(result[0]?.source).toBe("openmeteo");
    expect(result[1]?.condition).toBe("雨");
    expect(result[1]?.tempMaxC).toBe(23.0);
    expect(WeatherDailySchema.safeParse(result[0]).success).toBe(true);
  });

  it("Open-Meteo が失敗した場合は気象庁 API へフォールバックすること", async () => {
    const mockJmaResponse = [
      {
        publishingOffice: "気象庁",
        timeSeries: [
          {
            timeDefines: ["2026-06-24T11:00:00+09:00", "2026-06-25T00:00:00+09:00"],
            areas: [
              {
                area: { name: "東京地方", code: "130010" },
                weathers: ["晴れ 時々 曇り", "雨"],
                weatherCodes: ["101", "300"],
              },
            ],
          },
          {
            // 降水確率
            timeDefines: ["2026-06-24T12:00:00+09:00"],
            areas: [{ area: { name: "東京地方" }, pops: ["10"] }],
          },
          {
            // 気温
            timeDefines: ["2026-06-24T11:00:00+09:00", "2026-06-24T11:00:00+09:00"],
            areas: [{ area: { name: "東京" }, temps: ["28", "19"] }],
          },
        ],
      },
    ];

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("open-meteo")) {
        return new Response("Internal Server Error", { status: 500 });
      }
      if (url.includes("jma.go.jp")) {
        return new Response(JSON.stringify(mockJmaResponse), { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    });

    const client = new WeatherClient({});
    // 東京駅付近の座標
    const result = await client.getForecast(35.681238, 139.767125);

    expect(result.length).toBe(2);
    expect(result[0]?.condition).toBe("晴れ 時々 曇り");
    expect(result[0]?.source).toBe("jma");
    expect(result[0]?.tempMaxC).toBe(28);
    expect(result[0]?.tempMinC).toBe(19);
    expect(WeatherDailySchema.safeParse(result[0]).success).toBe(true);
  });
});

describe("LodgingClient", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("楽天トラベル API から宿リストを取得し正規化すること", async () => {
    const mockResponse = {
      hotels: [
        {
          hotel: [
            {
              hotelBasicInfo: {
                hotelNo: 12345,
                hotelName: "テストホテル東京",
                latitude: 35.68,
                longitude: 139.76,
                hotelMinCharge: 8000,
                reviewAverage: "4.25",
                hotelInformationUrl: "https://travel.rakuten.co.jp/hotel/12345/",
                hotelImageUrl: "https://img.travel.rakuten.co.jp/image.jpg",
                hotelThumbnailUrl: "https://img.travel.rakuten.co.jp/thumb.jpg",
              },
            },
          ],
        },
      ],
    };

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      expect(url).toContain("app.rakuten.co.jp/services/api/Travel/SimpleHotelSearch");
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    const client = new LodgingClient({ applicationId: "mock-rakuten-id" });
    const result = await client.searchHotels(35.68, 139.76);

    expect(result.length).toBe(1);
    expect(result[0]?.id).toBe("12345");
    expect(result[0]?.name).toBe("テストホテル東京");
    expect(result[0]?.pricePerNight?.amount).toBe(8000);
    expect(result[0]?.rating).toBe(4.25);
    expect(result[0]?.source).toBe("rakuten");
    expect(LodgingSchema.safeParse(result[0]).success).toBe(true);
  });

  it("applicationId がない場合は即座に空配列を返すこと", async () => {
    const client = new LodgingClient({});
    const result = await client.searchHotels(35.68, 139.76);
    expect(result).toEqual([]);
  });
});

describe("RestaurantClient", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("ホットペッパー API から飲食店リストを取得し正規化すること", async () => {
    const mockResponse = {
      results: {
        shop: [
          {
            id: "J000000001",
            name: "和食 テスト居酒屋",
            genre: { name: "居酒屋" },
            lat: 35.68,
            lng: 139.76,
            budget: { code: "B002", name: "2001～3000円" },
            urls: { pc: "https://www.hotpepper.jp/strJ000000001/" },
            photo: {
              pc: {
                l: "https://imgfp.hotp.jp/l.jpg",
                m: "https://imgfp.hotp.jp/m.jpg",
              },
            },
          },
        ],
      },
    };

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      expect(url).toContain("webservice.recruit.co.jp/hotpepper/gourmet");
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    const client = new RestaurantClient({ apiKey: "mock-hotpepper-key" });
    const result = await client.searchRestaurants(35.68, 139.76);

    expect(result.length).toBe(1);
    expect(result[0]?.id).toBe("J000000001");
    expect(result[0]?.name).toBe("和食 テスト居酒屋");
    expect(result[0]?.genre).toBe("居酒屋");
    expect(result[0]?.budget?.amount).toBe(2500); // B002 -> 2500
    expect(result[0]?.source).toBe("hotpepper");
    expect(RestaurantSchema.safeParse(result[0]).success).toBe(true);
  });

  it("apiKey がない場合は即座に空配列を返すこと", async () => {
    const client = new RestaurantClient({});
    const result = await client.searchRestaurants(35.68, 139.76);
    expect(result).toEqual([]);
  });
});

describe("TransitClient", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const fromPoint = { lat: 35.681238, lng: 139.767125 }; // 東京駅
  const toPoint = { lat: 35.65858, lng: 139.74543 }; // 東京タワー

  it("Google APIキーがある場合は Google Directions API を呼び出すこと", async () => {
    const mockResponse = {
      status: "OK",
      routes: [
        {
          legs: [
            {
              distance: { value: 3800 },
              duration: { value: 900 },
              steps: [
                {
                  travel_mode: "WALKING",
                  distance: { value: 800 },
                  duration: { value: 600 },
                  html_instructions: "徒歩で移動",
                },
                {
                  travel_mode: "TRANSIT",
                  distance: { value: 3000 },
                  duration: { value: 300 },
                  transit_details: {
                    departure_stop: { name: "大手町駅" },
                    arrival_stop: { name: "神谷町駅" },
                  },
                },
              ],
            },
          ],
          fare: { value: 180 },
        },
      ],
    };

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      expect(url).toContain("maps.googleapis.com/maps/api/directions/json");
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    const client = new TransitClient({ googleApiKey: "mock-google-key" });
    const result = await client.getDirections(
      fromPoint,
      toPoint,
      "東京駅",
      "東京タワー",
      "transit",
    );

    expect(result.length).toBe(2);
    expect(result[0]?.mode).toBe("walk");
    expect(result[1]?.mode).toBe("transit");
    expect(result[1]?.fromName).toBe("大手町駅");
    expect(result[1]?.toName).toBe("神谷町駅");
    expect(result[1]?.cost?.amount).toBe(180); // 最初の transit に料金付与
    expect(result[0]?.source).toBe("google");
    expect(TransportLegSchema.safeParse(result[0]).success).toBe(true);
  });

  it("Google APIキーがない場合は直線距離に基づいて所要時間を概算すること", async () => {
    const client = new TransitClient({});
    const result = await client.getDirections(fromPoint, toPoint, "東京駅", "東京タワー", "car");

    expect(result.length).toBe(1);
    expect(result[0]?.mode).toBe("car");
    expect(result[0]?.fromName).toBe("東京駅");
    expect(result[0]?.toName).toBe("東京タワー");
    expect(result[0]?.distanceKm).toBeGreaterThan(0);
    expect(result[0]?.durationMin).toBeGreaterThan(0);
    expect(result[0]?.source).toBeUndefined(); // APIキーなしでの概算のため
    expect(TransportLegSchema.safeParse(result[0]).success).toBe(true);
  });
});

describe("ImageClient", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("Unsplash API キーがある場合は Unsplash API を呼び出すこと", async () => {
    const mockResponse = {
      results: [
        {
          id: "photo-1",
          description: "東京の夜景",
          urls: {
            regular: "https://images.unsplash.com/photo-1-regular",
            small: "https://images.unsplash.com/photo-1-small",
          },
          user: {
            name: "山田太郎",
            links: { html: "https://unsplash.com/@yamada" },
          },
        },
      ],
    };

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      expect(url).toContain("api.unsplash.com/search/photos");
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    const client = new ImageClient({ unsplashAccessKey: "mock-unsplash-key" });
    const result = await client.searchImages("東京", 1);

    expect(result.length).toBe(1);
    expect(result[0]?.url).toBe("https://images.unsplash.com/photo-1-regular");
    expect(result[0]?.author).toBe("山田太郎");
    expect(result[0]?.source).toBe("unsplash");
    expect(ImageResultSchema.safeParse(result[0]).success).toBe(true);
  });

  it("Unsplashキーがなく Pexels キーがある場合は Pexels API を呼び出すこと", async () => {
    const mockResponse = {
      photos: [
        {
          id: 98765,
          alt: "富士山と桜",
          src: {
            large: "https://images.pexels.com/photos/98765-large",
            medium: "https://images.pexels.com/photos/98765-medium",
          },
          photographer: "佐藤花子",
          photographer_url: "https://www.pexels.com/@sato",
        },
      ],
    };

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      expect(url).toContain("api.pexels.com/v1/search");
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    const client = new ImageClient({ pexelsApiKey: "mock-pexels-key" });
    const result = await client.searchImages("富士山", 1);

    expect(result.length).toBe(1);
    expect(result[0]?.url).toBe("https://images.pexels.com/photos/98765-large");
    expect(result[0]?.author).toBe("佐藤花子");
    expect(result[0]?.source).toBe("pexels");
    expect(ImageResultSchema.safeParse(result[0]).success).toBe(true);
  });

  it("APIキーが何も設定されていない場合は即座に空配列を返すこと", async () => {
    const client = new ImageClient({});
    const result = await client.searchImages("東京");
    expect(result).toEqual([]);
  });
});
