# Project Concept: Lightweight 2D Welding Joint & Sequence Editor

## 1. Executive Summary
The goal of this project is to develop a lightweight, browser-based 2D CAD-style editor specifically designed for engineering cross-sections of welded joints and planning welding sequences. The application aims to replace generic drawing tools with a specialized environment where users can quickly assemble geometries, define weld beads, and generate technical documentation.

## 2. Core Philosophy & MVP Scope
The MVP (Minimum Viable Product) focuses on the fundamental ability to create a custom joint geometry and overlay it with a basic welding sequence. The application is designed with a **modular architecture** to ensure future scalability (e.g., adding standardized profile libraries, advanced metallurgical data, or complex DXF exports).

## 3. Key Functional Components (MVP)

### A. Primitive Geometric Components
Instead of static shapes, the editor uses parametric building blocks:
* **Plates:** Rectangular elements with adjustable width and thickness.
* **Pipes:** Concentric rings (circular hollow sections) with customizable diameters and wall thicknesses.
* **Profiles (L, C, I):** Structural shapes with freely adjustable dimensions (not yet bound by rigid regulatory standards), allowing for rapid prototyping of custom joints.

### B. Stage 1: Manipulation & Parameterization
* **Dynamic Sliders:** Real-time adjustment of dimensions (length, thickness, diameter) without the need for manual coordinate entry.
* **Transformation Tools:** Intuitive controls for rotation (precise angles), translation (moving), and zooming.
* **SNAP System:** Smart magnetic snapping for edges and key vertices to ensure precise assembly of components.
* **Unit Toggle:** Instant switching between Metric (mm) and Imperial (inches) systems.

### C. Stage 2: Welding Scheme & Sequencing
A dedicated workspace/view mode that utilizes the geometry prepared in Stage 1:
* **Bead Visualization:** Placeholder symbols (ellipses/circles) representing weld beads. The system is designed to eventually support complex, realistic weld shape modeling.
* **Annotation & Numbering:** Automatic or manual labeling (e.g., 1, 2, 3 or A, B, C) to define the order of welding operations. These symbols serve as references for external technical documentation.

## 4. Documentation & Export
The primary output of the MVP will be a **standardized PDF report** containing:
* A clear visual representation of the designed joint.
* The numbered welding sequence.
* A legend/table at the bottom of the page correlating symbols with specific process descriptions.

## 5. Technical Vision & Scalability
The application is built with a "Future-Proof" mindset. While the MVP is a simplified 2D tool, the underlying data structure allows for:
* Integration with international welding standards (ISO/AWS).
* Advanced styling for weld beads to reflect actual penetration profiles.
* Exporting to CAD-compatible formats (DXF/SVG).
