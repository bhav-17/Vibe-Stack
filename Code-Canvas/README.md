# ⚡ CodeCanvas

### See your code come to life.

**CodeCanvas** is an interactive code visualization playground that transforms code execution into a step-by-step visual experience. Write code, run it, track variables, and watch your program's logic unfold in real time.

Instead of just seeing the output, understand *how your code works*.

<p align="center">
  <img src="https://img.shields.io/badge/Status-In%20Development-59E3FF?style=for-the-badge&labelColor=0D1118" alt="Status: In Development" />
  <img src="https://img.shields.io/badge/Language-Python-FFD166?style=for-the-badge&labelColor=0D1118" alt="Python" />
  <img src="https://img.shields.io/badge/Frontend-Vanilla%20JS-F7DF1E?style=for-the-badge&labelColor=0D1118" alt="Vanilla JavaScript" />
</p>

---

## ✨ What is CodeCanvas?

Learning to program isn't just about knowing the syntax — it's about understanding what happens behind the scenes.

CodeCanvas aims to bridge that gap by turning abstract execution into an interactive visual journey.

* 🔍 **Visual Execution** — Follow your code as it executes, one step at a time.
* 📦 **Live Variables** — Watch variables and their values change during execution.
* 🔄 **Loop Visualization** — Understand iterations and how loops affect program state.
* 🖥️ **Interactive Console** — See program output and execution messages.
* 🧭 **Execution Timeline** — Explore the sequence of operations and program events.
* 🎨 **Developer-First UI** — A minimal dark interface with a futuristic cyan aesthetic.

## 🚀 Features

| Feature              | Description                                         |
| -------------------- | --------------------------------------------------- |
| Code Editor          | Write and modify code in an editor-style interface  |
| Execution Canvas     | Visualize program execution through connected nodes |
| Variable Inspector   | Track variable assignments and state changes        |
| Event Stream         | Follow execution events with line references        |
| Console Output       | View printed output, runtime messages, and errors   |
| Example Programs     | Experiment with loops, accumulators, and conditions |
| Execution Controls   | Run and reset visualizations                        |
| Responsive Interface | Work across desktop, tablet, and mobile layouts     |

## 🛠️ Tech Stack

* **HTML5** — Application structure
* **CSS3** — Styling, animations, and responsive layouts
* **JavaScript** — Execution logic, state management, and visualization
* **Python-inspired syntax** — The language experience being visualized

The goal is to keep the project lightweight, accessible, and easy to run without requiring a backend.

> **Note:** Python visualization support depends on the interpreter implemented in the project. A limited JavaScript-based interpreter is not equivalent to a full Python runtime.

## ⚡ Getting Started

### Prerequisites

* A modern web browser
* Git (optional)

### Installation

**1. Clone the repository**

```bash
git clone https://github.com/bhav-17/code-canvas.git
```

**2. Navigate to the project**

```bash
cd code-canvas
```

**3. Launch the application**

Open `index.html` in your browser.

Alternatively, use the **Live Server** extension in Visual Studio Code for local development.

No package installation or backend setup is required for the static version.

## 💡 Example

Try a simple accumulator:

```python
numbers = [2, 4, 6, 8]
total = 0

for number in numbers:
    total = total + number
    print(total)

print("done")
```

The expected output is:

```text
2
6
12
20
done
```

The goal is to visualize each iteration, show how `number` changes, track the updates to `total`, and connect those changes to the resulting output.

## 🎯 Who Is It For?

* 🧑‍🎓 Students learning programming fundamentals
* 🐍 Beginners exploring Python
* 🧠 Developers who prefer visual explanations
* 🔎 Anyone who wants to understand execution flow and debug more intuitively

## 🗺️ Roadmap

* [x] Dark-themed developer interface
* [x] Built-in code examples
* [ ] Step-by-step execution controls
* [ ] Improved variable state tracking
* [ ] Syntax highlighting and editor enhancements
* [ ] More loops, conditions, and data structure examples
* [ ] Breakpoints and execution speed controls
* [ ] Memory and stack visualization
* [ ] Expanded Python syntax support
* [ ] Shareable code examples
* [ ] Improved error explanations

*Roadmap items reflect planned improvements; completion status should be updated as the implementation evolves.*

## 🤝 Contributing

Contributions, feature suggestions, and bug reports are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Commit your changes.
4. Open a pull request describing your improvements.

For larger changes, consider opening an issue first to discuss the proposed implementation.

## 📌 Project Vision

CodeCanvas is built around one simple idea:

> **Programming becomes easier when you can see it.**

The long-term vision is to make code execution more intuitive through interactive visualizations, transparent state changes, and beginner-friendly debugging tools.

## 📄 License

This project is open source. Add a `LICENSE` file to specify the terms under which others may use, modify, and distribute the project.

---

<p align="center">
  <b>Built with curiosity and a little bit of code. ⚡</b>
  <br />
  <sub>CodeCanvas · Part of the VibeStack universe</sub>
</p>
