const listingTypeValues = new Set([
  "full_apartment",
  "private_room",
  "shared_room",
  "roommate_search",
  "unknown",
]);
const tenancyTypeValues = new Set(["new_lease", "lease_takeover", "sublet", "month_to_month", "unknown"]);
const bathroomValues = new Set(["private", "shared", "unknown"]);
const dateFlexibilityValues = new Set(["fixed", "flexible", "unknown"]);
const petsValues = new Set(["allowed", "not_allowed", "unknown"]);

const housingDetailsJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "listingType",
    "tenancyType",
    "priceMonthly",
    "bedrooms",
    "bathroom",
    "roommateCount",
    "locationText",
    "neighborhoodGuess",
    "availabilityStart",
    "availabilityEnd",
    "dateFlexibility",
    "durationText",
    "furnished",
    "pets",
    "notes",
  ],
  properties: {
    listingType: {
      type: "string",
      enum: ["full_apartment", "private_room", "shared_room", "roommate_search", "unknown"],
    },
    tenancyType: {
      type: "string",
      enum: ["new_lease", "lease_takeover", "sublet", "month_to_month", "unknown"],
    },
    priceMonthly: { type: ["integer", "null"] },
    bedrooms: { anyOf: [{ type: "integer" }, { const: "studio" }, { type: "null" }] },
    bathroom: { type: "string", enum: ["private", "shared", "unknown"] },
    roommateCount: { type: ["integer", "null"] },
    locationText: { type: ["string", "null"] },
    neighborhoodGuess: { type: "string" },
    availabilityStart: { type: ["string", "null"] },
    availabilityEnd: { type: ["string", "null"] },
    dateFlexibility: { type: "string", enum: ["fixed", "flexible", "unknown"] },
    durationText: { type: ["string", "null"] },
    furnished: { type: ["boolean", "null"] },
    pets: { type: "string", enum: ["allowed", "not_allowed", "unknown"] },
    notes: { type: "array", items: { type: "string" }, maxItems: 50 },
  },
};

export async function parseHousingDetailsWithOpenAI({ apiKey, capturedText, sourceGroupName }) {
  let response;

  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.5",
        store: false,
        input: [
          {
            role: "system",
            content:
              "Extract structured housing listing details from a Facebook post. Use unknown or null when the post does not say.",
          },
          {
            role: "user",
            content: `Group: ${sourceGroupName}\n\nPost:\n${capturedText}`,
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "housing_details",
            strict: true,
            schema: housingDetailsJsonSchema,
          },
        },
      }),
    });
  } catch {
    return { ok: false, error: "openai_request_failed" };
  }

  if (!response.ok) {
    return { ok: false, error: "openai_request_failed" };
  }

  const responseBody = await readResponseBody(response);
  const outputText = extractOutputText(responseBody);

  if (!outputText) {
    return { ok: false, error: "missing_structured_output" };
  }

  let parsedDetails;

  try {
    parsedDetails = JSON.parse(outputText);
  } catch {
    return { ok: false, error: "invalid_structured_output" };
  }

  const details = normalizeHousingDetails(parsedDetails);

  if (!details) {
    return { ok: false, error: "invalid_structured_output" };
  }

  return { ok: true, details };
}

function extractOutputText(responseBody) {
  if (!isPlainObject(responseBody)) {
    return null;
  }

  if (typeof responseBody.output_text === "string" && responseBody.output_text.length > 0) {
    return responseBody.output_text;
  }

  if (Array.isArray(responseBody.output_text)) {
    const outputText = responseBody.output_text.filter((item) => typeof item === "string");

    if (outputText.length > 0) {
      return outputText.join("\n");
    }
  }

  if (!Array.isArray(responseBody.output)) {
    return null;
  }

  const chunks = responseBody.output.flatMap((outputItem) => {
    if (!isPlainObject(outputItem) || !Array.isArray(outputItem.content)) {
      return [];
    }

    return outputItem.content.flatMap((contentItem) => {
      if (!isPlainObject(contentItem)) {
        return [];
      }

      if (contentItem.type === "output_text" && typeof contentItem.text === "string") {
        return [contentItem.text];
      }

      if (typeof contentItem.output_text === "string") {
        return [contentItem.output_text];
      }

      return [];
    });
  });

  return chunks.length > 0 ? chunks.join("\n") : null;
}

async function readResponseBody(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeHousingDetails(details) {
  if (!isPlainObject(details)) {
    return null;
  }

  const listingType = readEnum(details.listingType, listingTypeValues);
  const tenancyType = readEnum(details.tenancyType, tenancyTypeValues);
  const priceMonthly = normalizeNullableInteger(details.priceMonthly, { min: 1 });
  const bedrooms = normalizeBedrooms(details.bedrooms);
  const bathroom = readEnum(details.bathroom, bathroomValues);
  const roommateCount = normalizeNullableInteger(details.roommateCount, { min: 0 });
  const locationText = normalizeNullableString(details.locationText);
  const neighborhoodGuess = normalizeRequiredString(details.neighborhoodGuess);
  const availabilityStart = normalizeNullableString(details.availabilityStart);
  const availabilityEnd = normalizeNullableString(details.availabilityEnd);
  const dateFlexibility = readEnum(details.dateFlexibility, dateFlexibilityValues);
  const durationText = normalizeNullableString(details.durationText);
  const furnished = normalizeNullableBoolean(details.furnished);
  const pets = readEnum(details.pets, petsValues);
  const notes = normalizeStringArray(details.notes);

  if (
    !listingType ||
    !tenancyType ||
    priceMonthly === undefined ||
    bedrooms === undefined ||
    !bathroom ||
    roommateCount === undefined ||
    locationText === undefined ||
    !neighborhoodGuess ||
    availabilityStart === undefined ||
    availabilityEnd === undefined ||
    !dateFlexibility ||
    durationText === undefined ||
    furnished === undefined ||
    !pets ||
    !notes
  ) {
    return null;
  }

  return {
    listingType,
    tenancyType,
    priceMonthly,
    bedrooms,
    bathroom,
    roommateCount,
    locationText,
    neighborhoodGuess,
    availabilityStart,
    availabilityEnd,
    dateFlexibility,
    durationText,
    furnished,
    pets,
    notes,
  };
}

function normalizeBedrooms(value) {
  if (value === null) {
    return null;
  }

  if (value === "studio") {
    return "studio";
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  return undefined;
}

function normalizeNullableInteger(value, { min }) {
  if (value === null) {
    return null;
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= min) {
    return value;
  }

  return undefined;
}

function normalizeNullableString(value) {
  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return undefined;
}

function normalizeNullableBoolean(value) {
  if (value === null || typeof value === "boolean") {
    return value;
  }

  return undefined;
}

function normalizeRequiredString(value) {
  if (typeof value === "string" && value) {
    return value;
  }

  return null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value) || value.length > 50 || value.some((entry) => typeof entry !== "string")) {
    return null;
  }

  return [...value];
}

function readEnum(value, allowedValues) {
  return typeof value === "string" && allowedValues.has(value) ? value : null;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
