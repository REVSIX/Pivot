# Pendulum lab

Two articulated links, two hinge joints and two joint motors. The 2 ms RK4 model starts from the `release` keyframe. The Pivot simulation viewport runs the XML with its keyframe's two constant motor inputs. The terminal example runs the same XML with a Python PD controller.

1. Open `pendulum.xml` in the simulation workspace. Run, pause, step once and reset. Check that a single step adds 0.002 s.
2. Open `controller.py` in the editor. The gains and setpoint are in `config/control.toml`.
3. After setting up Python, run `& $env:PIVOT_PYTHON .\controller.py` in the Windows Pivot terminal. On a POSIX shell, use `"$PIVOT_PYTHON" ./controller.py`. The script applies control and exports torque, position error and elbow velocity at simulation timestamps. Observe these signals in Debug.
4. Run `telem list`, `telem graph torque position_error` or `telem record --seconds 8`. The recording uses AdvantageScope's CSV List format.

Run `python scripts/inspect_model.py` to inspect link masses and the actuator-to-joint mapping. The same actions appear in the project task list. Opening the folder does not execute the controller.
