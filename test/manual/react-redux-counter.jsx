// Browser demonstration of the proposed authoring model, not a Telegram widget.
// Run: node test/manual/react-redux-counter.mjs
import {createRoot} from 'react-dom/client';
import {Provider, useDispatch, useSelector} from 'react-redux';
import {configureStore, createSlice} from '@reduxjs/toolkit';

const counter = createSlice({
  name: 'counter',
  initialState: {value: 0},
  reducers: {
    add(state, action) { state.value += action.payload; },
    reset(state) { state.value = 0; },
  },
});

// One store for this application instance, shared by both views.
const store = configureStore({reducer: {counter: counter.reducer}});

function Counter({title}) {
  const value = useSelector(state => state.counter.value);
  const dispatch = useDispatch();

  return (
    <section aria-label={title}>
      <h2>{title}</h2>
      <output aria-label="Count">{value}</output>
      <div className="buttons">
        <button onClick={() => dispatch(counter.actions.add(-1))}>−1</button>
        <button onClick={() => dispatch(counter.actions.add(1))}>+1</button>
        <button onClick={() => dispatch(counter.actions.reset())}>Reset</button>
      </div>
    </section>
  );
}

function StatePreview() {
  const value = useSelector(state => state.counter);
  return <pre aria-label="Redux state">{JSON.stringify({counter: value}, null, 2)}</pre>;
}

createRoot(document.getElementById('root')).render(
  <Provider store={store}>
    <h1>React + Redux counter</h1>
    <p>Two views share one store. Buttons in either view update both.</p>
    <main>
      <Counter title="View A" />
      <Counter title="View B" />
    </main>
    <StatePreview />
    <p>Browser demo only. Reload resets state; Telegram delivery and persistence are not implemented here.</p>
  </Provider>
);
