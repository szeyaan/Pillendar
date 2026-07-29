import os
import glob
import sys
import json
from datetime import datetime, timedelta
from google import genai
from google.genai import types

# --- 1. CONFIGURATION ---

# IMPORTANT: Best practice is to set your API key as an environment variable (GEMINI_API_KEY).
API_KEY = os.getenv("GEMINI_API_KEY", "")

# Define your image paths here. 
IMAGE_DIRECTORY = r"C:\Users\John\Desktop\generalbarca\hackathon project"
IMAGE_EXTENSIONS = ['*.jpg', '*.jpeg', '*.png', '*.gif', '*.bmp', '*.tiff', 
                    '*.JPG', '*.JPEG', '*.PNG', '*.GIF', '*.BMP', '*.TIFF']

IMAGE_PATHS = []
for ext in IMAGE_EXTENSIONS:
    search_pattern = os.path.join(IMAGE_DIRECTORY, ext)
    IMAGE_PATHS.extend(glob.glob(search_pattern))

print(f"Searching in directory: {IMAGE_DIRECTORY}")
if IMAGE_PATHS:
    print(f"Successfully found {len(IMAGE_PATHS)} image file(s).")
    for path in IMAGE_PATHS:
        print(f" - {path}")
else:
    print("WARNING: No image files were found in the specified directory.")

# --- 2. HELPER FUNCTIONS ---

def load_images_as_parts(paths):
    """
    Loads one or more image files from local paths and converts them into 
    Gemini API Part objects for the contents list.
    """
    if not paths:
        sys.exit("ERROR: No image paths provided in IMAGE_PATHS list.")
    
    image_parts = []
    print(f"Loading {len(paths)} image(s)...")
    
    for i, path in enumerate(paths):
        try:
            with open(path, "rb") as f:
                file_data = f.read()
            
            # Assuming JPEG, adjust if necessary
            part = types.Part.from_bytes(data=file_data, mime_type="image/jpeg")
            image_parts.append(part)
            print(f"DEBUG: Successfully read {len(file_data)} bytes from image {i+1}: '{os.path.basename(path)}'")
            
        except FileNotFoundError:
            print(f"FATAL ERROR: File not found at path: {path}")
            sys.exit(1)
        except Exception as e:
            print(f"FATAL ERROR: Failed to load image at {path}. Exception: {e}")
            sys.exit(1)
            
    return image_parts

def format_dt(dt):
    """Formats datetime object into the required ICS UTC format (YYYYMMDDTHHMMSSZ)."""
    return dt.strftime("%Y%m%dT%H%M%SZ")

def generate_ics_content(medication_name, dosage_strength, directions):
    """
    Generates the content for a daily recurring iCalendar (.ics) file
    based on the extracted medication directions.
    """
    # 1. Determine frequency and corresponding times
    directions_upper = directions.upper()
    
    if "THREE TIMES A DAY" in directions_upper or "3 TIMES DAILY" in directions_upper or "TID" in directions_upper:
        times = [7, 13, 20]  # 7am, 1pm, 8pm
        summary_suffix = " (3x Day)"
    elif "TWICE DAILY" in directions_upper or "2 TIMES A DAY" in directions_upper or "BID" in directions_upper:
        times = [7, 19]  # 7am, 7pm
        summary_suffix = " (2x Day)"
    elif "ONCE DAILY" in directions_upper or "1 TIME A DAY" in directions_upper or "QD" in directions_upper:
        times = [8]  # 8am
        summary_suffix = " (1x Day)"
    else:
        # Fallback for unclear or unsupported directions (e.g., "AS NEEDED")
        return None, "Frequency could not be determined for automatic scheduling."

    # 2. Set event details
    event_duration_minutes = 15
    summary = f"💊 Take {medication_name} - {dosage_strength}{summary_suffix}"
    description = f"Medication: {medication_name}\nDosage: {dosage_strength}\nInstructions: {directions}"

    # 3. Create ICS header
    ics_lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//MediScan//NONSGML v1.0//EN"
    ]
    
    # 4. Create one VEVENT block for each scheduled time
    # Events start today (or slightly in the future if the time has passed)
    now = datetime.utcnow()
    
    # Set the starting date/time (DTSTART) to the next time the dose should be taken
    for hour in times:
        dt_start_local = datetime.now().replace(hour=hour, minute=0, second=0, microsecond=0)
        
        # If the scheduled time has already passed today, start the recurrence tomorrow.
        if dt_start_local < datetime.now():
            dt_start_local += timedelta(days=1)
            
        # Convert the start time to UTC for the ICS file
        dt_start_utc = dt_start_local - dt_start_local.utcoffset()
        dt_end_utc = dt_start_utc + timedelta(minutes=event_duration_minutes)
        
        ics_lines.extend([
            "BEGIN:VEVENT",
            f"UID:{os.urandom(16).hex()}", # Unique ID for each event
            f"DTSTAMP:{format_dt(now)}",
            f"DTSTART:{format_dt(dt_start_utc)}",
            f"DTEND:{format_dt(dt_end_utc)}",
            "RRULE:FREQ=DAILY", # Daily recurrence
            f"SUMMARY:{summary}",
            f"DESCRIPTION:{description.replace('\\n', '\\n ')}",
            "END:VEVENT"
        ])

    # 5. Create ICS footer
    ics_lines.append("END:VCALENDAR")
    
    # Return the content as a single string
    return "\r\n".join(ics_lines), "Successfully generated daily medication schedule."


# --- 3. RESPONSE SCHEMA DEFINITION ---

# Define the exact structure of the JSON output we require from the model.
schema = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "medication_name": types.Schema(
            type=types.Type.STRING,
            description="The full, unambiguous name of the medication (e.g., Lipitor, Amoxicillin)."
        ),
        "dosage_strength": types.Schema(
            type=types.Type.STRING,
            description="The strength and form of the medication (e.g., 500 MG CAP, 2.5mg Tablet)."
        ),
        "directions": types.Schema(
            type=types.Type.STRING,
            description="The exact, fully capitalized instructions for use from the label (e.g., TAKE 1 CAPSULE TWICE DAILY)."
        ),
        "frequency": types.Schema( # <-- NEW FIELD FOR SCHEDULING
            type=types.Type.STRING,
            description="The dosing frequency extracted from the directions. Must be one of: 'ONCE DAILY', 'TWICE DAILY', 'THREE TIMES A DAY', or 'AS NEEDED/OTHER'."
        )
    },
    # Ensure all these keys must be present in the final JSON output
    required=["medication_name", "dosage_strength", "directions", "frequency"] 
)

# --- 4. MAIN LOGIC ---

def run_extractor():
    """Initializes the client, loads data, calls the API, and processes the result."""
    
    if not API_KEY:
        sys.exit("ERROR: API_KEY is missing. Please set the GEMINI_API_KEY environment variable or hardcode it.")