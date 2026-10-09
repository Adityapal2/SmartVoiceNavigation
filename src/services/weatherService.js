import axios from "axios";

const API_KEY = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY;

export const getWeatherByCoordinates = async (latitude, longitude) => {
  if (!API_KEY) {
    throw new Error("Weather API key missing. Check your .env file.");
  }

  try {
    const response = await axios.get(
      "https://api.openweathermap.org/data/2.5/weather",
      {
        params: {
          lat: latitude,
          lon: longitude,
          appid: API_KEY,
          units: "metric",
        },
        timeout: 10000,
      }
    );

    const data = response.data;

    return {
      city: data.name || "Unknown location",
      temperature: Math.round(data.main.temp),
      feelsLike: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      description: data.weather?.[0]?.description || "Unknown",
      windSpeed: data.wind?.speed ?? 0,
    };
  } catch (error) {
    if (error.response?.status === 401) {
      throw new Error("Invalid API key or API key not activated.");
    }

    if (error.response?.status === 429) {
      throw new Error("Weather API rate limit reached.");
    }

    if (error.response) {
      throw new Error(`Weather API error: ${error.response.status}`);
    }

    if (error.code === "ECONNABORTED") {
      throw new Error("Weather request timed out.");
    }

    throw new Error("Internet connection check karo.");
  }
};