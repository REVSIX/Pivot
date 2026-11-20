FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libegl1 libglfw3 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/pivot
COPY simulator/requirements.txt simulator/mcap-requirements.txt ./simulator/
RUN pip install --no-cache-dir -r simulator/requirements.txt -r simulator/mcap-requirements.txt
COPY simulator/run.py simulator/export.py ./simulator/
COPY scripts/csv_to_mcap.py scripts/
COPY examples/pendulum/pendulum.xml ./examples/pendulum/pendulum.xml
ENV PYTHONDONTWRITEBYTECODE=1
CMD ["python", "simulator/export.py", "examples/pendulum/pendulum.xml", "/runs/pendulum.csv"]
